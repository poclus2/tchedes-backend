import axios from 'axios';
import crypto from 'crypto';
import { db } from '../lib/db';

export class WebhookService {
    static async signAndDispatch(tenantId: string, sessionId: string, newStatus: string) {
        // 1. Fetch Session and Tenant details
        const session = await db.kycSession.findUnique({
            where: { id: sessionId },
            include: {
                Tenant: {
                    include: { WebhookEndpoints: { where: { active: true } } }
                },
                UserIdentity: true
            }
        });

        if (!session || !session.Tenant.WebhookEndpoints.length) {
            console.log(`[Webhook] No active endpoints for Tenant ${tenantId}. Skipping.`);
            return;
        }

        // 2. Build Payload
        const payload = {
            event_id: `evt_${crypto.randomUUID().replace(/-/g, '')}`,
            type: `identity.kyc.${newStatus}`, // e.g. identity.kyc.verified
            created_at: Math.floor(Date.now() / 1000),
            data: {
                session_id: session.id,
                reference_id: session.UserIdentity.reference_id,
                status: session.status,
                confidence_score: session.confidence_score,
                extracted_fields: session.extracted_fields
            }
        };

        const payloadString = JSON.stringify(payload);
        const timestamp = Date.now().toString();
        const secret = session.Tenant.webhook_secret;

        // 3. HMAC-SHA256 Signature (Tchedes-Signature)
        // Structure: t={timestamp},v1={hash}
        const signaturePayload = `${timestamp}.${payloadString}`;
        const hash = crypto.createHmac('sha256', secret).update(signaturePayload).digest('hex');
        const signatureHeader = `t=${timestamp},v1=${hash}`;

        // 4. Dispatch to all active endpoints
        for (const endpoint of session.Tenant.WebhookEndpoints) {
            try {
                await axios.post(endpoint.url, payloadString, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Tchedes-Signature': signatureHeader,
                        'Tchedes-Timestamp': timestamp
                    },
                    timeout: 10000 // 10s max
                });
                console.log(`[Webhook] Delivered ${payload.event_id} to ${endpoint.url}`);
            } catch (error: any) {
                console.error(`[Webhook] Delivery failed to ${endpoint.url}: ${error.message}`);
                throw error; // Let BullMQ catch this and retry contextually
            }
        }
    }
}
