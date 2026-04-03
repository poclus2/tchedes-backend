import { CM_CNI_ExtractedFields, OCRExtractionResult } from './ocr.service';
import { FaceMatchResult } from './face.service';

export interface DecisionResult {
    final_status: 'verified' | 'rejected' | 'review_required';
    final_confidence: number;
    reasons: string[];
    breakdown: {
        ocr: number;
        fields: number;
        face: number;
    };
    merged_fields: CM_CNI_ExtractedFields;
}

export class DecisionEngine {
    static readonly ENGINE_VERSION = 'decision-engine@0.1.0';

    static evaluate(
        frontOcr: OCRExtractionResult,
        backOcr: OCRExtractionResult,
        faceMatch: FaceMatchResult,
        cniType?: string
    ): DecisionResult {
        const reasons: string[] = [];
        const isOldLaminated = cniType === 'old_laminated';

        // Merge fields logically: prefer truthy values from back, but do not overwrite
        // valid front values with undefined/null from back.
        const merged_fields: CM_CNI_ExtractedFields = { ...frontOcr.parsed_fields };
        for (const [key, value] of Object.entries(backOcr.parsed_fields)) {
            if (value !== undefined && value !== null && value !== '') {
                (merged_fields as any)[key] = value;
            }
        }

        // 1. Calculate Field Completeness (30% weight)
        // Old laminated CNI: no expiry date printed → remove from mandatory list
        const required = isOldLaminated
            ? ['first_name', 'last_name', 'id_number', 'date_of_birth']
            : ['first_name', 'last_name', 'id_number', 'date_of_birth', 'date_of_expiry'];
        let presentCount = 0;
        for (const req of required) {
            if ((merged_fields as any)[req]) presentCount++;
            else reasons.push(`Missing mandatory field: ${req}`);
        }

        // date_of_issue is evaluated for score but missing it doesn't auto-fail the whole core list
        if (!merged_fields.date_of_issue) {
            reasons.push(`Missing field: date_of_issue (non-critical)`);
        } else {
            presentCount += 0.5; // slight bonus
        }

        const fieldScore = Math.min(100, Math.round((presentCount / required.length) * 100));

        // 2. Combine OCR Confidence (40% weight)
        const ocrScore = (frontOcr.confidence + backOcr.confidence) / 2;

        // 3. Final Weighted Score
        const final_confidence = Math.round(
            (ocrScore * 0.40) +
            (fieldScore * 0.30) +
            (faceMatch.face_match_score * 0.30)
        );

        // Baseline constraints
        let final_status: 'verified' | 'rejected' | 'review_required' = 'verified';

        // Rule: Expiry Check
        if (merged_fields.date_of_expiry) {
            const expiryDate = new Date(merged_fields.date_of_expiry);
            if (expiryDate < new Date()) {
                final_status = 'rejected';
                reasons.push('Document is expired');
            }
        }

        // Rule: MRZ Verification (Optimistic Approach)
        let mrzBonus = 0;
        if (backOcr.parsed_fields.has_mrz && backOcr.parsed_fields.mrz_data) {
            const mrz = backOcr.parsed_fields.mrz_data;
            if (mrz.valid === false) {
                final_status = 'review_required';
                reasons.push('MRZ checksum validation failed or formatting is invalid.');
            } else {
                let mrzMatchesCount = 0;
                let mrzMismatchFound = false;

                // Helper to normalize strings for comparison
                const normalize = (str: string | undefined) => str ? str.toUpperCase().replace(/\s+/g, '') : '';

                // Cross-check Last Name
                if (mrz.lastName && normalize(merged_fields.last_name).includes(normalize(mrz.lastName))) {
                    mrzMatchesCount++;
                } else if (mrz.lastName && merged_fields.last_name) {
                    mrzMismatchFound = true;
                    reasons.push(`MRZ Last Name mismatch: Visual[${merged_fields.last_name}] vs MRZ[${mrz.lastName}]`);
                }

                // Cross-check First Name
                if (mrz.firstName && normalize(merged_fields.first_name).includes(normalize(mrz.firstName.split('<')[0]))) {
                    mrzMatchesCount++;
                }

                // Give bonus if MRZ is valid and matches VIZ data
                if (!mrzMismatchFound && mrzMatchesCount > 0) {
                    mrzBonus = 10; // +10% confidence bonus for mathematically valid and correlated MRZ
                    reasons.push('MRZ Validated successfully and correlates with extracted text.');
                } else if (mrzMismatchFound) {
                    final_status = 'review_required';
                    reasons.push('Inconsistencies detected between visual text and MRZ data.');
                }
            }
        }

        // Rule: Missing core fields = auto reject
        if (fieldScore < 80) {
            final_status = 'rejected';
        } else if (fieldScore < 100 && final_status === 'verified') {
            final_status = 'review_required'; // Downgrade to manual review if core fields are missing
        }

        // Rule: Confidence Thresholds
        let adjusted_confidence = Math.min(100, final_confidence + mrzBonus);
        if (final_status !== 'rejected') {
            if (adjusted_confidence < 85 && adjusted_confidence >= 70) {
                final_status = 'review_required';
                reasons.push(`Confidence score (${adjusted_confidence}%) below 85% threshold`);
            } else if (adjusted_confidence < 70 || faceMatch.face_match_score < 70) {
                final_status = 'rejected';
                reasons.push('Confidence score or face match too low');
            }
        }

        return {
            final_status,
            final_confidence: adjusted_confidence,
            reasons,
            merged_fields,
            breakdown: {
                ocr: ocrScore,
                fields: fieldScore,
                face: faceMatch.face_match_score
            }
        };
    }
}
