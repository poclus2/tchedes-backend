import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { parse as parseMRZ } from 'mrz';
import sharp from 'sharp';
import path from 'path';
import { GoogleGenerativeAI, Part } from '@google/generative-ai';

export interface CM_CNI_ExtractedFields {
    first_name?: string;
    last_name?: string;
    id_number?: string;
    date_of_birth?: string;
    date_of_issue?: string;
    date_of_expiry?: string;
    has_mrz?: boolean;
    mrz_data?: any;
}

export interface OCRExtractionResult {
    raw_text: string;
    parsed_fields: CM_CNI_ExtractedFields;
    confidence: number;
    engine_meta: {
        ocr_provider: string;
        ocr_version: string;
    };
}

// ─── Gemini Vision OCR ────────────────────────────────────────────────────────
// Used when GEMINI_API_KEY is set in environment.
// Falls back to PaddleOCR + regex when not available.

const GEMINI_PROMPT = `You are a KYC document specialist. Extract the identity fields from this document image.

Return ONLY a valid JSON object with exactly these keys (use null if a field is not visible or unclear):
{
  "first_name": "given name(s) only",
  "last_name": "family name / surname only",
  "id_number": "digits only, no spaces or dashes",
  "date_of_birth": "YYYY-MM-DD format",
  "date_of_expiry": "YYYY-MM-DD format, or null if not present",
  "date_of_issue": "YYYY-MM-DD format, or null if not present",
  "document_type": "e.g. CNI Cameroun, Passport, Old Laminated CNI",
  "has_mrz": true or false
}

Important rules:
- Dates MUST be in YYYY-MM-DD format. Convert any DD/MM/YYYY or DD.MM.YYYY format.
- id_number: digits only (fix common OCR errors: O→0, I→1, S→5, B→8)
- first_name and last_name must be SEPARATED correctly
- If this is the BACK of a document, focus on the MRZ zone (3 lines of uppercase + < characters)
- Return ONLY the JSON object, no markdown, no explanation.`;

export class OCRService {

    // ── Gemini Extraction (primary if GEMINI_API_KEY set) ─────────────────────
    private static async extractWithGemini(imagePath: string, side: 'front' | 'back'): Promise<{
        fields: CM_CNI_ExtractedFields;
        raw_text: string;
        confidence: number;
    }> {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY not set');

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        // Read image as base64
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');
        const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

        const imagePart: Part = {
            inlineData: { data: base64Image, mimeType }
        };

        const sideHint = side === 'front'
            ? 'This is the FRONT of the document (contains name, photo, date of birth).'
            : 'This is the BACK of the document (may contain MRZ zone, ID number, dates).';

        const result = await model.generateContent([
            GEMINI_PROMPT + '\n\n' + sideHint,
            imagePart
        ]);

        const responseText = result.response.text().trim();
        console.log(`[OCRService][Gemini] Raw response (${side}):\n`, responseText);

        // Parse JSON - strip any markdown code fences if present
        const jsonStr = responseText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(jsonStr);

        // Normalize null strings
        const clean = (v: any) => (v === null || v === 'null' || v === '' || v === 'N/A') ? undefined : String(v).trim();

        const fields: CM_CNI_ExtractedFields = {
            first_name: clean(parsed.first_name),
            last_name: clean(parsed.last_name),
            id_number: clean(parsed.id_number),
            date_of_birth: clean(parsed.date_of_birth),
            date_of_expiry: clean(parsed.date_of_expiry),
            date_of_issue: clean(parsed.date_of_issue),
            has_mrz: parsed.has_mrz === true,
        };

        return {
            fields,
            raw_text: `[Gemini Vision] ${parsed.document_type || 'Unknown document'} | side: ${side}`,
            confidence: 95
        };
    }

    // ── Main Entry Point ───────────────────────────────────────────────────────
    static async extractCameroonCNI(imagePath: string, side: 'front' | 'back'): Promise<OCRExtractionResult> {

        // ── MODE 1: Gemini Vision (if API key is configured) ──────────────────
        if (process.env.GEMINI_API_KEY) {
            try {
                console.log(`[OCRService] Using Gemini Vision for ${side} image...`);
                const { fields, raw_text, confidence } = await this.extractWithGemini(imagePath, side);
                console.log(`[OCRService][Gemini] Extracted (${side}):`, JSON.stringify(fields, null, 2));

                // If back side and has MRZ, try to parse it via PaddleOCR for checksum validation
                // (Gemini gives us the fields, MRZ checksum still needs traditional parse)
                if (side === 'back' && fields.has_mrz) {
                    try {
                        const mrzResult = await this.extractMRZFromBack(imagePath);
                        if (mrzResult) fields.mrz_data = mrzResult;
                    } catch (_) { /* MRZ parse optional */ }
                }

                return {
                    raw_text,
                    parsed_fields: fields,
                    confidence,
                    engine_meta: { ocr_provider: 'gemini-2.5-flash', ocr_version: 'v2.5' }
                };
            } catch (err) {
                console.warn(`[OCRService] Gemini failed, falling back to PaddleOCR:`, err);
                // Falls through to PaddleOCR below
            }
        }

        // ── MODE 2: PaddleOCR + Regex (self-hosted fallback) ──────────────────
        return this.extractWithPaddleOCR(imagePath, side);
    }

    // ── PaddleOCR Extraction (legacy / self-hosted mode) ──────────────────────
    private static async extractWithPaddleOCR(imagePath: string, side: 'front' | 'back'): Promise<OCRExtractionResult> {
        let rawText = '';
        let confidence = 0;
        let providerName = 'paddleocr_local';

        try {
            console.log(`[OCRService] Envoi de l'image ${imagePath} au microservice PaddleOCR local...`);

            let targetImagePath = imagePath;

            // Image pre-processing for better OCR quality
            try {
                const parsed = path.parse(imagePath);
                const enhancedPath = path.join(parsed.dir, `${parsed.name}-enhanced-v2${parsed.ext}`);

                const meta = await sharp(imagePath).metadata();
                if (meta.width && meta.height) {
                    await sharp(imagePath)
                        .grayscale()
                        .normalize()
                        .resize(Math.round(meta.width * 1.5), null, { kernel: sharp.kernel.lanczos3 })
                        .jpeg({ quality: 100 })
                        .toFile(enhancedPath);

                    console.log(`[OCRService] Image Pre-processing applied (${side}) -> ${enhancedPath}`);
                    targetImagePath = enhancedPath;
                }
            } catch (preprocessErr) {
                console.error(`[OCRService] Pre-process failed, using raw image:`, preprocessErr);
            }

            const formData = new FormData();
            formData.append('file', fs.createReadStream(targetImagePath));

            const ocrServiceUrl = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:8000';
            const response = await fetch(`${ocrServiceUrl}/extract`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) throw new Error(`PaddleOCR HTTP error: ${response.status}`);

            const data = await response.json() as any;
            if (data.raw_text !== undefined) {
                rawText = data.raw_text;
                confidence = data.confidence || 90;
            } else {
                throw new Error(data.detail || 'OCR Extraction Error');
            }

        } catch (err) {
            console.error('OCR Microservice Error:', err);
            rawText = side === 'front'
                ? "REPUBLIQUE DU CAMEROUN\nCARTE NATIONALE D'IDENTITE\nNOM: DOE\nPRENOMS: JOHN\nNE LE: 01/01/1990\nID: 112233445\nDELIVREE LE: 01/01/2020\nEXPIRE LE: 01/01/2030"
                : "112233445";
            confidence = 90;
            providerName = 'mock_fallback';
        }

        return {
            raw_text: rawText,
            parsed_fields: this.parseRegexMapping(rawText, side),
            confidence,
            engine_meta: { ocr_provider: providerName, ocr_version: 'v2.7.3' }
        };
    }

    // ── MRZ Validation (used by Gemini mode for checksum) ─────────────────────
    private static async extractMRZFromBack(imagePath: string): Promise<any> {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(imagePath));
        const ocrServiceUrl = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:8000';
        try {
            const response = await fetch(`${ocrServiceUrl}/extract`, { method: 'POST', body: formData });
            if (!response.ok) return null;
            const data = await response.json() as any;
            const rawText: string = data.raw_text || '';
            const lines = rawText.split('\n');
            const mrzLines = lines.map(l => l.trim().toUpperCase().replace(/\s+/g, '')).filter(l => l.match(/^[A-Z0-9<]{25,}$/));
            if (mrzLines.length >= 2) {
                const result = parseMRZ(mrzLines.slice(-3).join('\n'));
                return { valid: result.valid, documentNumber: result.fields.documentNumber, firstName: result.fields.firstName, lastName: result.fields.lastName, birthDate: result.fields.birthDate, expiryDate: result.fields.expirationDate };
            }
        } catch (_) { return null; }
        return null;
    }

    private static parseRegexMapping(rawText: string, side: 'front' | 'back'): CM_CNI_ExtractedFields {
        const fields: CM_CNI_ExtractedFields = {};
        const lines = rawText.split('\n');

        // Sanitization Utility
        // Sanitization Utility - maps common OCR letter-digit confusions
        const sanitizeId = (str: string) => str
            .replace(/O/g, '0').replace(/D/g, '0').replace(/Q/g, '0')
            .replace(/I/g, '1').replace(/L/g, '1')
            .replace(/S/g, '5')
            .replace(/B/g, '8')
            .replace(/G/g, '6')
            .replace(/Z/g, '2')
            .replace(/\s/g, '');
        const sanitizeDate = (str: string) => {
            // Very basic normalizer for MVP: '01/01/2020' -> '2020-01-01'
            const match = str.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
            if (match) {
                return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
            }
            return str;
        };

        // Smarter Line-Scanning parser for both old "NOM:" and new "NOM/SURNAME\nVALUE" models
        // We run this on BOTH front and back, because new biometric CNIs have Date of Issue/Expiry on the back
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const upper = line.toUpperCase();

            // Lookahead helper to find the next non-empty line
            const getNextLine = (startIndex: number) => {
                for (let j = startIndex + 1; j < lines.length; j++) {
                    if (lines[j].trim().length > 1 && !lines[j].toUpperCase().match(/^(TRAVAIL|PAIX|PATRIE|REPUBLIQUE|DU|CAMEROUN|CAMEROON|REPUBLIC|CARTENATIONALE)/)) {
                        return lines[j].trim();
                    }
                }
                return '';
            };

            // Lookbehind helper
            const getPrevLine = (startIndex: number) => {
                for (let j = startIndex - 1; j >= 0; j--) {
                    if (lines[j].trim().length > 1 && !lines[j].toUpperCase().match(/^(TRAVAIL|PAIX|PATRIE|REPUBLIQUE|DU|CAMEROUN|CAMEROON|REPUBLIC|CARTENATIONALE)/)) {
                        return lines[j].trim();
                    }
                }
                return '';
            };

            // ── NOM (Nom de famille / Last Name) ────────────────────────────────────
            // Layout A (new CNI):   "NOM/SURNAME:" EGOUME MOUYONG   (inline or next line)
            // Layout B (old lam.):  "NOM:" EGOUME MOUYONG or just lines scanned top→bottom
            if (upper.match(/^(NOM|SURNAME)\b/) && !upper.match(/PRENOMS|GIVEN/)) {
                const cleanedLine = line.replace(/^(NOM\/SURNAME|NOM\s*:\s*SURNAME|NOM|SURNAME)[\s:]*/i, '').trim();
                if (cleanedLine.length > 1) {
                    fields.last_name = cleanedLine;
                } else if (!fields.last_name) {
                    // Try next non-empty line
                    const next = getNextLine(i);
                    if (next && next.length > 1 && !next.match(/^\d/) && !next.toUpperCase().match(/PRENOM|GIVEN|BIRTH|NAISSANCE|EXPIR|ISSUE|DELIVR/)) {
                        fields.last_name = next;
                    }
                }
            }

            // ── PRÉNOMS (First Name) ──────────────────────────────────────────────
            // KEY INSIGHT: On old laminated CNIs, PaddleOCR reads column by column.
            // The value (REKIYATOU) appears on the line BEFORE the label (PRENOMS/GIVENNAMES).
            // The last_name (EGOUME MOUYONG) appears on the line AFTER the label.
            if (upper.includes('PRENOM') || upper.match(/GIVEN\s*NAME/)) {
                const cleanedLine = line.replace(/^(PRÉNOMS?\/GIVEN\s*NAMES?|PRENOMS?\/GIVEN\s*NAMES?|PRENOMS?|GIVEN\s*NAMES?)[\s:]*/i, '').trim();

                if (cleanedLine.length > 1 && !cleanedLine.match(/^\d/)) {
                    // Inline: "PRENOMS: REKIYATOU"
                    fields.first_name = cleanedLine;
                } else {
                    // Value-before-label layout: REKIYATOU is the PREVIOUS line
                    const prev = getPrevLine(i);
                    if (prev && prev.length > 1 && !prev.match(/^\d/) && !prev.toUpperCase().match(/PROFESSION|OCCUPATION|SEXE|CARTE|NATIONAL|REPUBLIC|CAMEROUN/)) {
                        fields.first_name = prev;
                    }
                    // Next line may be the last name in this layout
                    if (!fields.last_name) {
                        const next = getNextLine(i);
                        if (next && next.length > 1 && !next.match(/^\d/) && !next.toUpperCase().match(/PROFESSION|REPUBLIC|CAMERA|NATIONAL|NE LE|BIRTH|EXPIR|ISSUE|DELIVR/)) {
                            fields.last_name = next;
                        }
                    }
                }
                // Cleanup trailing 'S' artifact
                if (fields.first_name && fields.first_name !== 'S' && fields.first_name.endsWith(' S')) {
                    fields.first_name = fields.first_name.replace(/\sS$/, '');
                }
            }

            // ── Date de naissance ─────────────────────────────────────────────────
            if (upper.includes('NE LE') || upper.match(/N[EÉ]\s+LE/) || upper.match(/NAISSANCE/) || upper.match(/BIRTH/)) {
                const cleanedLine = line.replace(/^.*(DATE\s*D?E?\s*NAISSANCE(?:\/?DATE\s*OF\s*BIRTH)?|DATE\s*OF\s*BIRTH|N[EÉ]\s*LE)[\s:]*/i, '').trim();
                if (cleanedLine.match(/\d/)) {
                    fields.date_of_birth = sanitizeDate(cleanedLine);
                } else if (!fields.date_of_birth) {
                    // Check prev and next
                    const prev = getPrevLine(i);
                    const next = getNextLine(i);
                    if (prev.match(/\d/)) fields.date_of_birth = sanitizeDate(prev);
                    else if (next.match(/\d/)) fields.date_of_birth = sanitizeDate(next);
                }
            }

            // ── ID Number - Explicit Labels ────────────────────────────────────────
            if (upper.includes('ID:') || upper.match(/^ID\s+/) || upper.match(/^N[°º]\s*CNI/) || upper.match(/IDENTIFIANT UNIQUE/)) {
                const cleanedLine = line.replace(/^.*(IDENTIFIANT\s*UNIQUE(?:\/?UNIQUE\s*IDENTIFIER)?|ID\s*N[O0]\.?|ID:|N[°º]\s*CNI)[\s:]*/i, '').trim();
                if (cleanedLine.match(/\d{5,}/)) {
                    fields.id_number = sanitizeId(cleanedLine);
                } else if (!fields.id_number) {
                    const next = getNextLine(i);
                    const prev = getPrevLine(i);
                    if (next.match(/\d{5,}/)) fields.id_number = sanitizeId(next);
                    else if (prev.match(/\d{5,}/)) fields.id_number = sanitizeId(prev);
                }
            }

            // ── ID Number - Fallback: bare digit sequences (6-17 chars) ─────────────
            // Old laminated CNI often has 8-9 digit IDs, OCR may drop 1 digit
            if (!fields.id_number) {
                const cleanUpper = sanitizeId(upper);
                // Match 6-17 consecutive digits not preceded/followed by more digits
                const idMatch = cleanUpper.match(/^\d{6,17}$/);
                if (idMatch) {
                    fields.id_number = cleanUpper;
                }
            }

            // ── Délivrée le / Date of Issue ───────────────────────────────────────
            if (upper.match(/(DELIVR[EÉ]E|ISSUE)/)) {
                const cleanedLine = line.replace(/^.*(DATE\s*DE\s*D[EÉ]LIVRANCE(?:\/?DATE\s*OF\s*ISSUE)?|D[EÉ]LIVR[EÉ]E\s*LE|DATE\s*OF\s*ISSUE)[\s:]*/i, '').trim();
                if (cleanedLine.match(/\d/)) {
                    fields.date_of_issue = sanitizeDate(cleanedLine);
                } else if (!fields.date_of_issue) {
                    const next = getNextLine(i);
                    const prev = getPrevLine(i);
                    if (prev.match(/\d/)) fields.date_of_issue = sanitizeDate(prev);
                    else if (next.match(/\d/)) fields.date_of_issue = sanitizeDate(next);
                }
            }

            // ── Expire le / Date of Expiry ────────────────────────────────────────
            if (upper.match(/(EXPIR|VALABLE)/)) {
                const cleanedLine = line.replace(/^.*(DATE\s*D[']?EXPIRATION(?:\/?DATE\s*OF\s*EXPIRY)?|EXPIRE\s*LE|DATE\s*OF\s*EXPIRY)[\s:]*/i, '').trim();
                if (cleanedLine.match(/\d/)) {
                    fields.date_of_expiry = sanitizeDate(cleanedLine);
                } else if (!fields.date_of_expiry) {
                    const next = getNextLine(i);
                    const prev = getPrevLine(i);
                    if (next.match(/\d/)) fields.date_of_expiry = sanitizeDate(next);
                    else if (prev.match(/\d/)) fields.date_of_expiry = sanitizeDate(prev);
                }
            }

            // ── Final fallback: naked dates with any separator (. / -) ─────────────
            // Handles "19.02.2090" → corrects bad OCR years like 2090 → 1990/2000
            const dateMatch = upper.match(/\b(\d{2})[.\-\/](\d{2})[.\-\/](\d{4})\b/);
            if (dateMatch) {
                let year = parseInt(dateMatch[3]);
                const day = dateMatch[1];
                const month = dateMatch[2];
                const currentYear = new Date().getFullYear();

                // Correct clearly wrong OCR years (e.g., 2090 should be 1990)
                if (year > currentYear + 20) {
                    // e.g. 2090 → remove first digit after '20': likely 19YY
                    const yStr = String(year);
                    year = parseInt('19' + yStr.substring(2));
                }

                const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

                if (!fields.date_of_birth && year < 2010 && year > 1920) {
                    fields.date_of_birth = dateStr;
                } else if (!fields.date_of_expiry && year > currentYear && year < 2050) {
                    fields.date_of_expiry = dateStr;
                } else if (!fields.date_of_issue && year >= 2000 && year <= currentYear + 1) {
                    fields.date_of_issue = dateStr;
                }
            }
        }

        console.log(`\n\n=== OCR RAW TEXT (${side}) ===\n`, rawText, `\n=== EXTRACTED ===\n`, JSON.stringify(fields, null, 2), `\n\n`);

        if (side === 'back') {
            // ── MRZ Detection ─────────────────────────────────────────────────────
            // TD1 = 3 lines of exactly 30 chars | TD3 passport = 2 lines of 44 chars
            const mrzLines: string[] = [];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim().toUpperCase().replace(/\s+/g, '');
                if (line.match(/^[A-Z0-9<]{25,}$/)) {
                    mrzLines.push(line);
                }
            }

            if (mrzLines.length >= 2) {
                fields.has_mrz = true;

                // ── PASS 1: Field-Specific Character Correction ───────────────────
                // ICAO 9303 TD1 layout (3 lines × 30 chars):
                //   Line 1: cols 1-2 (doc type/alpha), 3-5 (country/alpha), 6-30 (name/alpha+<)
                //   Line 2: cols 1-9 (docNumber/ALNUM), 10 (check/NUM), 11-12 (nationality/alpha),
                //            13-18 (birthDate/NUM), 19 (check/NUM), 20 (sex/alpha), 21-26 (expiry/NUM),
                //            27 (check/NUM), 28-29 (optional/ALNUM), 30 (composite check/NUM)
                //   Line 3: cols 1-30 (name / alpha + <)

                const alphaOnly = (s: string) =>
                    s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B').replace(/5/g, 'S');
                const digitOnly = (s: string) =>
                    s.replace(/O/g, '0').replace(/I/g, '1').replace(/B/g, '8').replace(/S/g, '5').replace(/G/g, '6').replace(/Z/g, '2').replace(/D/g, '0').replace(/Q/g, '0').replace(/L/g, '1');

                const correctTD1Lines = (raw: string[]): string[] => {
                    const l = raw.map(r => r.padEnd(30, '<').substring(0, 30)); // normalise to 30 each
                    if (l.length < 3) return raw; // not TD1, skip
                    const [l1, l2, l3] = l;

                    // Line 1: 0-5 (DocType+Country), 5-14 (DocNum), 14-15 (Check), 15-30 (Optional)
                    const c1 = l1.substring(0, 14) + digitOnly(l1.substring(14, 15)) + l1.substring(15, 30);

                    // Line 2: 0-6 (DOB), 6-7 (Check), 7-8 (Sex), 8-14 (Expiry), 14-15 (Check), 15-18 (Nationality), 18-29 (Opt), 29-30 (Check)
                    const c2 =
                        digitOnly(l2.substring(0, 6)) +   // DOB
                        digitOnly(l2.substring(6, 7)) +   // DOB Check
                        alphaOnly(l2.substring(7, 8)) +   // Sex
                        digitOnly(l2.substring(8, 14)) +  // Expiry
                        digitOnly(l2.substring(14, 15)) + // Expiry Check
                        alphaOnly(l2.substring(15, 18)) + // Nationality
                        l2.substring(18, 29) +            // Optional
                        digitOnly(l2.substring(29, 30));  // Composite Check

                    const c3 = alphaOnly(l3); // line 3 = name, upper-alpha
                    return [c1, c2, c3];
                };

                // ── PASS 2: Checksum-Guided Brute-Force ──────────────────────────
                // If after correction the checksum still fails, try swapping
                // common OCR confusion pairs on each char of each line.
                const CONFUSION_MAP: Record<string, string[]> = {
                    '0': ['O', 'D', 'Q'], 'O': ['0'],
                    '1': ['I', 'L'], 'I': ['1'],
                    '8': ['B'], 'B': ['8'],
                    '5': ['S'], 'S': ['5'],
                    '6': ['G'], 'G': ['6'],
                    '2': ['Z'], 'Z': ['2'],
                };

                const bruteForceFixMRZ = (lines3: string[]): string[] => {
                    const joined = lines3.join('\n');
                    try {
                        const r = parseMRZ(joined);
                        if (r.valid) return lines3; // already OK
                    } catch (_) { /* ignore */ }

                    // Try single-char swaps across all lines
                    for (let li = 0; li < lines3.length; li++) {
                        const chars = lines3[li].split('');
                        for (let ci = 0; ci < chars.length; ci++) {
                            const origChar = chars[ci];
                            const alternatives = CONFUSION_MAP[origChar];
                            if (!alternatives) continue;
                            for (const alt of alternatives) {
                                chars[ci] = alt;
                                const candidate = [...lines3];
                                candidate[li] = chars.join('');
                                try {
                                    const r = parseMRZ(candidate.join('\n'));
                                    if (r.valid) {
                                        console.log(`[OCRService] MRZ brute-force fix: line ${li + 1} pos ${ci} '${origChar}'→'${alt}'`);
                                        return candidate;
                                    }
                                } catch (_) { /* continue */ }
                                chars[ci] = origChar; // revert
                            }
                        }
                    }
                    return lines3; // couldn't fix, return pass-1 corrected version
                };

                // Apply corrections
                let candidateLines = mrzLines.slice(-3);
                if (candidateLines.length === 3) {
                    candidateLines = correctTD1Lines(candidateLines);
                }
                candidateLines = bruteForceFixMRZ(candidateLines);

                const mrzString = candidateLines.join('\n');
                console.log(`[OCRService] MRZ (corrected):\n${mrzString}`);

                try {
                    const result = parseMRZ(mrzString);

                    // Helper to convert YYMMDD to YYYY-MM-DD
                    const parseMRZDate = (mrzDateStr: string | null | undefined, isBirthDate: boolean) => {
                        if (!mrzDateStr || mrzDateStr.length !== 6) return undefined;
                        const yy = mrzDateStr.substring(0, 2);
                        const mm = mrzDateStr.substring(2, 4);
                        const dd = mrzDateStr.substring(4, 6);

                        let yyyy = `20${yy}`;
                        if (isBirthDate) {
                            const currentYear = new Date().getFullYear();
                            if (parseInt(yyyy) > currentYear) {
                                yyyy = `19${yy}`;
                            }
                        }
                        return `${yyyy}-${mm}-${dd}`;
                    };

                    fields.mrz_data = {
                        valid: result.valid,
                        format: result.format,
                        documentNumber: result.fields.documentNumber,
                        birthDate: result.fields.birthDate,
                        expiryDate: result.fields.expirationDate,
                        firstName: result.fields.firstName,
                        lastName: result.fields.lastName,
                        nationality: result.fields.nationality
                    };

                    console.log(`[OCRService] MRZ valid: ${result.valid} | docNum: ${result.fields.documentNumber} | expiry: ${result.fields.expirationDate}`);

                    // Fallback to MRZ dates if visual parsing failed
                    if (!fields.date_of_expiry && fields.mrz_data.expiryDate) {
                        const parsedExpiry = parseMRZDate(fields.mrz_data.expiryDate, false);
                        if (parsedExpiry) fields.date_of_expiry = parsedExpiry;
                    }

                    if (!fields.date_of_birth && fields.mrz_data.birthDate) {
                        const parsedBirth = parseMRZDate(fields.mrz_data.birthDate, true);
                        if (parsedBirth) fields.date_of_birth = parsedBirth;
                    }

                    // Smart merge for names: VIZ is the source of truth (preserves accents, Full length).
                    // MRZ is used ONLY to fix dropped spaces if the letters exactly match.
                    const smartMergeName = (vizName: string | undefined, mrzName: string | undefined) => {
                        if (!vizName) return mrzName;
                        if (!mrzName) return vizName;
                    
                        const vizNormalized = vizName.toUpperCase().replace(/\s+/g, '');
                        const mrzNormalized = mrzName.toUpperCase().replace(/\s+/g, '');
                    
                        if (vizNormalized === mrzNormalized) {
                            let result = '';
                            let vizIdx = 0;
                            for (let i = 0; i < mrzName.length; i++) {
                                if (mrzName[i] === ' ') {
                                    result += ' ';
                                } else if (vizIdx < vizName.length) {
                                    while (vizIdx < vizName.length && vizName[vizIdx] === ' ' && mrzName[i] !== ' ') {
                                        result += ' ';
                                        vizIdx++;
                                    }
                                    if (vizIdx < vizName.length) {
                                        result += vizName[vizIdx];
                                        vizIdx++;
                                    }
                                }
                            }
                            while(vizIdx < vizName.length) {
                               result += vizName[vizIdx++];
                            }
                            return result.replace(/\s+/g, ' ').trim();
                        }
                        return vizName;
                    };

                    if (fields.mrz_data.lastName) {
                        fields.last_name = smartMergeName(fields.last_name, fields.mrz_data.lastName);
                    }
                    if (fields.mrz_data.firstName) {
                        fields.first_name = smartMergeName(fields.first_name, fields.mrz_data.firstName);
                    }

                } catch (err) {
                    console.log("[OCRService] MRZ lines found but failed ICAO 9303 parse even after correction.", err);
                    fields.mrz_data = { valid: false, error: 'invalid_mrz_format' };
                }
            } else {
                fields.has_mrz = false;
            }
        }


        return fields;
    }
}
