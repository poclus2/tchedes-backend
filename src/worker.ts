import { Worker } from 'bullmq';
import { redis } from './lib/redis';
import { db } from './lib/db';
import { OCRService } from './services/ocr.service';
import { FaceMatchService } from './services/face.service';
import { DecisionEngine } from './services/decision.service';
import { webhookQueue } from './queue/webhookQueue';
import { WebhookService } from './services/webhook.service';
import dotenv from 'dotenv';

dotenv.config();

console.log('[Worker] Starting KYC Processing Worker...');

const worker = new Worker('kyc-processing', async (job) => {
    const { sessionId, tenantId } = job.data;
    console.log(`[Worker] Processing Job ID: ${job.id} for Session: ${sessionId}`);

    try {
        const session = await db.kycSession.findUnique({
            where: { id: sessionId },
            include: { Documents: true }
        });

        if (!session || session.status !== 'processing') {
            console.warn(`[Worker] Session ${sessionId} not found or not in 'processing' state. Aborting.`);
            return;
        }

        const frontDoc = session.Documents.find(d => d.type === 'front');
        const backDoc = session.Documents.find(d => d.type === 'back');
        const selfieDoc = session.Documents.find(d => d.type === 'selfie');

        if (!frontDoc || !backDoc || !selfieDoc) {
            throw new Error('Missing required documents for processing');
        }

        // 1. OCR Extraction (Front: Visual fields | Back: Visual fields + MRZ detection)
        const frontOcr = await OCRService.extractCameroonCNI(frontDoc.s3_key, 'front');
        const backOcr = await OCRService.extractCameroonCNI(backDoc.s3_key, 'back');

        // 2. CNI Type Detection (automatic and passive based on MRZ presence)
        const isNewCNI = backOcr.parsed_fields.has_mrz === true;
        const cniType = isNewCNI ? 'new_biometric_td1' : 'old_laminated';
        console.log(`[Worker] CNI Type Detected: ${cniType}`);

        if (isNewCNI) {
            const mrzValid = backOcr.parsed_fields.mrz_data?.valid;
            console.log(`[Worker] MRZ Present. Checksum Validation: ${mrzValid ? '✅ VALID' : '❌ INVALID'}`);
        } else {
            console.log(`[Worker] No MRZ found. Proceeding with VIZ-only analysis (old CNI).`);
        }

        // 3. Face Match (selfie vs. front ID photo)
        const faceMatch = await FaceMatchService.compareImages(selfieDoc.s3_key, frontDoc.s3_key);

        if (faceMatch.error) {
            console.warn(`[Worker] Face match encountered an error: ${faceMatch.error}. Score: ${faceMatch.face_match_score}`);
        } else {
            console.log(`[Worker] Face Match Score: ${faceMatch.face_match_score}% | Passed: ${faceMatch.passed}`);
        }

        // 3. Decision Engine
        const decision = DecisionEngine.evaluate(frontOcr, backOcr, faceMatch);

        console.log(`[Worker] Decision reached for ${sessionId}: ${decision.final_status} (${decision.final_confidence}%)`);

        // 5. Update Database — store all enriched fields
        await db.kycSession.update({
            where: { id: sessionId },
            data: {
                status: decision.final_status,
                confidence_score: decision.final_confidence,
                extracted_fields: {
                    // Visual data from OCR
                    ...decision.merged_fields,
                    // Pipeline metadata
                    cni_type: cniType,
                    mrz_present: isNewCNI,
                    mrz_valid: backOcr.parsed_fields.mrz_data?.valid ?? null,
                    face_match_score: faceMatch.face_match_score,
                    face_match_passed: faceMatch.passed,
                    face_match_error: faceMatch.error ?? null,
                    // Decision reasons - persisted for dashboard display
                    decision_reasons: decision.reasons,
                } as any,
                engine_version: DecisionEngine.ENGINE_VERSION,
            }
        });


        // 6. Write Immutable Audit Log
        await db.auditLog.create({
            data: {
                tenant_id: tenantId,
                session_id: sessionId,
                actor: 'system',
                action: 'engine_decision',
                previous_state: 'processing',
                new_state: decision.final_status,
                reason: decision.reasons.length > 0
                    ? decision.reasons.join(' | ')
                    : 'Automated approval — all checks passed',
                engine_version: [
                    DecisionEngine.ENGINE_VERSION,
                    `ocr:${frontOcr.engine_meta.ocr_provider}@${frontOcr.engine_meta.ocr_version}`,
                    `cni_type:${cniType}`,
                    `mrz:${isNewCNI ? (backOcr.parsed_fields.mrz_data?.valid ? 'valid' : 'invalid') : 'absent'}`,
                    `face:${faceMatch.face_match_score}%`,
                ].join(' | ')
            }
        });

        // 7. [Phase 1.5] Enqueue Webhook Dispatch
        try {
            await webhookQueue.add('dispatch', {
                sessionId,
                tenantId,
                status: decision.final_status
            });
            console.log(`[Worker] Successfully enqueued webhook dispatch for Session: ${sessionId}`);
        } catch (webhookErr) {
            console.error(`[Worker] Failed to enqueue webhook dispatch... proceeding regardless:`, webhookErr);
        }

        console.log(`[Worker] Successfully completed job for Session: ${sessionId}`);

    } catch (error) {
        console.error(`[Worker] Job Failed for Session ${sessionId}:`, error);
        throw error; // Let BullMQ retry
    }
}, { connection: redis });

worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed with error:`, err.message);
});

console.log('[Worker] Worker is listening to queue "kyc-processing"...');

// Start Webhook Dispatch Worker separately
console.log('[Worker] Starting Webhook Dispatch Worker...');
const webhookWorker = new Worker('webhook-dispatch', async (job) => {
    const { tenantId, sessionId, status } = job.data;
    console.log(`[Webhook Worker] Processing dispatch for Session: ${sessionId}`);
    await WebhookService.signAndDispatch(tenantId, sessionId, status);
}, { connection: redis });

webhookWorker.on('failed', (job, err) => {
    console.error(`[Webhook Worker] Job ${job?.id} failed with error:`, err.message);
});
