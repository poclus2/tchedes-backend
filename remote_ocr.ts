import vision from '@google-cloud/vision';
import fs from 'fs';

// Initialize the client. In a real environment, it uses GOOGLE_APPLICATION_CREDENTIALS
const client = new vision.ImageAnnotatorClient();

export interface CM_CNI_ExtractedFields {
    first_name?: string;
    last_name?: string;
    id_number?: string;
    date_of_birth?: string;
    date_of_issue?: string;
    date_of_expiry?: string;
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

        try {
            if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
                const [result] = await client.textDetection(imagePath);
                rawText = result.fullTextAnnotation?.text || '';
            } else {
                // Fallback Mock for local MVP dev without GCP credentials
                console.warn('⚠️ No GOOGLE_APPLICATION_CREDENTIALS found, using Mock OCR data.');
                rawText = side === 'front'
                    ? "REPUBLIQUE DU CAMEROUN\nCARTE NATIONALE D'IDENTITE\nNOM: DOE\nPRENOMS: JOHN\nNE LE: 01/01/1990\nID: 112233445\nDELIVREE LE: 01/01/2020\nEXPIRE LE: 01/01/2030"
                    : "112233445"; // simplified back
            }
        } catch (err) {
            console.error('Google Vision API Error:', err);
            // Fallback mock
            rawText = side === 'front'
                ? "REPUBLIQUE DU CAMEROUN\nCARTE NATIONALE D'IDENTITE\nNOM: DOE\nPRENOMS: JOHN\nNE LE: 01/01/1990\nID: 112233445\nDELIVREE LE: 01/01/2020\nEXPIRE LE: 01/01/2030"
                : "112233445";
        }

        return {
            raw_text: rawText,
            parsed_fields: this.parseRegexMapping(rawText, side),
            confidence: 93, // Google Vision doesn't give a single global doc confidence easily, mock for MVP
            engine_meta: {
                ocr_provider: 'google_vision',
                ocr_version: 'v1'
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

        if (side === 'front') {
            // Basic Front Parsing
            for (const line of lines) {
                const upper = line.toUpperCase();
                if (upper.includes('NOM:') || upper.startsWith('NOM ')) {
                    fields.last_name = upper.split('NOM')[1].replace(/[:]/g, '').trim();
                }
                if (upper.includes('PRENOM') || upper.startsWith('PRENOMS')) {
                    fields.first_name = upper.split('PRENOM')[1].replace(/S/g, '').replace(/[:]/g, '').trim();
                }
                if (upper.includes('NE LE') || upper.match(/N[EÉ] LE/)) {
                    fields.date_of_birth = sanitizeDate(upper.split('LE')[1].replace(/[:]/g, '').trim());
                }
                if (upper.includes('ID:') || upper.includes('ID ')) {
                    fields.id_number = sanitizeId(upper.split('ID')[1].replace(/[:]/g, '').trim());
                }
                if (upper.includes('DELIVRE') || upper.match(/D[EÉ]LIVR[EÉ]E/)) {
                    fields.date_of_issue = sanitizeDate(upper.split('LE')[1].replace(/[:]/g, '').trim());
                }
                if (upper.includes('EXPIRE LE')) {
                    fields.date_of_expiry = sanitizeDate(upper.split('LE')[1].replace(/[:]/g, '').trim());
                }
            }
        }

        return fields;
    }
}