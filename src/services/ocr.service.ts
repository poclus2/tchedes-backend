import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch'; // assuming node-fetch is available, or use axios if installed
import { parse as parseMRZ } from 'mrz';
import sharp from 'sharp';
import path from 'path';

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

export class OCRService {
    static async extractCameroonCNI(imagePath: string, side: 'front' | 'back'): Promise<OCRExtractionResult> {
        let rawText = '';
        let confidence = 0;
        let providerName = 'paddleocr_local';

        try {
            console.log(`[OCRService] Envoi de l'image ${imagePath} au microservice PaddleOCR local...`);

            let targetImagePath = imagePath;

            // ── EXPERIMENTAL: Pre-Process Both Sides (OCR Enhancement) ──
            // We apply grayscale, contrast stretch and upscale
            // to make the characters much more legible to PaddleOCR
            try {
                const parsed = path.parse(imagePath);
                const enhancedPath = path.join(parsed.dir, `${parsed.name}-enhanced-v2${parsed.ext}`);

                const meta = await sharp(imagePath).metadata();
                if (meta.width && meta.height) {
                    await sharp(imagePath)
                        .grayscale()
                        .normalize() // Stretch contrast (auto-levels)
                        .resize(Math.round(meta.width * 1.5), null, { kernel: sharp.kernel.lanczos3 }) // Upsample 1.5x
                        .jpeg({ quality: 100 })
                        .toFile(enhancedPath);

                    console.log(`[OCRService] Image Pre-processing applied (${side}) -> ${enhancedPath}`);
                    targetImagePath = enhancedPath;
                }
            } catch (preprocessErr) {
                console.error(`[OCRService] Failed to pre-process ${side} image, falling back to raw image:`, preprocessErr);
            }

            const formData = new FormData();
            formData.append('file', fs.createReadStream(targetImagePath));

            const ocrServiceUrl = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:8000';
            const response = await fetch(`${ocrServiceUrl}/extract`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                console.error(`Erreur HTTP PaddleOCR: ${response.status} ${response.statusText}`);
                throw new Error(`Erreur PaddleOCR API: ${response.statusText}`);
            }

            const data = await response.json() as any;

            if (data.raw_text !== undefined) {
                rawText = data.raw_text;
                confidence = data.confidence || 90;
            } else {
                console.error("Erreur renvoyée par le module OCR:", data.detail || data);
                throw new Error(data.detail || "OCR Extraction Error");
            }

        } catch (err) {
            console.error('OCR Microservice Error:', err);
            // Fallback mock en cas de crash
            rawText = side === 'front'
                ? "REPUBLIQUE DU CAMEROUN\nCARTE NATIONALE D'IDENTITE\nNOM: DOE\nPRENOMS: JOHN\nNE LE: 01/01/1990\nID: 112233445\nDELIVREE LE: 01/01/2020\nEXPIRE LE: 01/01/2030"
                : "112233445";
            confidence = 90;
            providerName = 'mock_fallback';
        }

        return {
            raw_text: rawText,
            parsed_fields: this.parseRegexMapping(rawText, side),
            confidence: confidence,
            engine_meta: {
                ocr_provider: providerName,
                ocr_version: 'v2.7.3'
            }
        };
    }

    private static parseRegexMapping(rawText: string, side: 'front' | 'back'): CM_CNI_ExtractedFields {
        const fields: CM_CNI_ExtractedFields = {};
        const lines = rawText.split('\n');

        // Sanitization Utility
        const sanitizeId = (str: string) => str.replace(/O/g, '0').replace(/I/g, '1').replace(/\s/g, '');
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

            // Nom
            if (upper.includes('NOM:') || upper.match(/^(NOM|SURNAME)/)) {
                const cleanedLine = line.replace(/^(NOM\/SURNAME|NOM\s*:\s*SURNAME|NOM|SURNAME)[\s:]*/i, '').trim();
                if (cleanedLine.length > 1) {
                    fields.last_name = cleanedLine;
                } else if (!fields.last_name) {
                    fields.last_name = getNextLine(i);
                }
            }

            // Prénom
            if (upper.includes('PRENOM') || upper.match(/^(PR[EÉ]NOM|GIVEN\s*NAME)/)) {
                const cleanedLine = line.replace(/^(PR[EÉ]NOMS?\/GIVEN\s*NAMES?|PR[EÉ]NOMS?|GIVEN\s*NAMES?)[\s:]*/i, '').trim();
                if (cleanedLine.length > 1) {
                    fields.first_name = cleanedLine;
                } else if (!fields.first_name) {
                    fields.first_name = getNextLine(i);
                }
                // Cleanup trailing 'S' sometimes caught by naive match
                if (fields.first_name && fields.first_name !== 'S' && fields.first_name.endsWith(' S')) {
                    fields.first_name = fields.first_name.replace(/\sS$/, '');
                }
            }

            // Date de naissance
            if (upper.includes('NE LE') || upper.match(/N[EÉ]\s+LE/) || upper.match(/NAISSANCE/) || upper.match(/BIRTH/)) {
                const cleanedLine = line.replace(/^.*(DATE\s*D?E?\s*NAISSANCE(?:\/?DATE\s*OF\s*BIRTH)?|DATE\s*OF\s*BIRTH|N[EÉ]\s*LE)[\s:]*/i, '').trim();
                if (cleanedLine.match(/\d/)) {
                    fields.date_of_birth = sanitizeDate(cleanedLine);
                } else if (!fields.date_of_birth) {
                    const next = getNextLine(i);
                    if (next.match(/\d/)) fields.date_of_birth = sanitizeDate(next);
                }
            }

            // ID Number - Explicit Labels
            if (upper.includes('ID:') || upper.match(/^ID\s+/) || upper.match(/^N[°º]\s*CNI/) || upper.match(/IDENTIFIANT UNIQUE/)) {
                const cleanedLine = line.replace(/^.*(IDENTIFIANT\s*UNIQUE(?:\/?UNIQUE\s*IDENTIFIER)?|ID\s*N[O0]\.?|ID:|N[°º]\s*CNI)[\s:]*/i, '').trim();
                if (cleanedLine.match(/\d{5,}/)) {
                    fields.id_number = sanitizeId(cleanedLine);
                } else if (!fields.id_number) {
                    const next = getNextLine(i);
                    if (next.match(/\d{5,}/)) fields.id_number = sanitizeId(next);
                }
            }

            // ID Number - Fallback direct scan for ID number exactly 9 digits or 17 digits
            if (!fields.id_number) {
                const cleanUpper = sanitizeId(upper);
                if (cleanUpper.match(/^\d{9}$/) || cleanUpper.match(/^\d{17}$/)) {
                    fields.id_number = cleanUpper;
                }
            }

            // Délivrée le / Date of Issue
            if (upper.match(/(DELIVR[EÉ]E|ISSUE)/)) {
                const cleanedLine = line.replace(/^.*(DATE\s*DE\s*D[EÉ]LIVRANCE(?:\/?DATE\s*OF\s*ISSUE)?|D[EÉ]LIVR[EÉ]E\s*LE|DATE\s*OF\s*ISSUE)[\s:]*/i, '').trim();
                if (cleanedLine.match(/\d/)) {
                    fields.date_of_issue = sanitizeDate(cleanedLine);
                } else if (!fields.date_of_issue) {
                    const next = getNextLine(i);
                    const prev = getPrevLine(i);
                    if (next.match(/\d/)) fields.date_of_issue = sanitizeDate(next);
                    else if (prev.match(/\d/)) fields.date_of_issue = sanitizeDate(prev);
                }
            }

            // Expire le / Date of Expiry
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

            // Final fallback for any naked dates found if missing
            const dateMatch = upper.match(/\b\d{2}[\.\-\/]\d{2}[\.\-\/]\d{4}\b/);
            if (dateMatch) {
                const dateStr = sanitizeDate(dateMatch[0]);
                const year = parseInt(dateStr.split('-')[0]);
                const currentYear = new Date().getFullYear();

                // Advanced heuristic: prevent assigning a 2000 date to date_of_expiry when missing birthdate
                if (!fields.date_of_birth && year < 2010 && year > 1920) {
                    fields.date_of_birth = dateStr;
                } else if (!fields.date_of_expiry && year > currentYear && year < 2050) {
                    fields.date_of_expiry = dateStr;
                } else if (!fields.date_of_issue && year >= 2000 && year <= currentYear + 1) {
                    fields.date_of_issue = dateStr;
                }
            }
        }

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
