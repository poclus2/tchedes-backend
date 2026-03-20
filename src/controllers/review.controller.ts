import { Request, Response } from 'express';
import { db } from '../lib/db';
import { kycQueue } from '../queue/kycQueue';
import { webhookQueue } from '../queue/webhookQueue';

export const submitManualReview = async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const { status, reason, reviewed_by } = req.body;
    const tenantId = req.tenant!.id;

    if (!['verified', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Manual review status must be either verified or rejected' });
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
        return res.status(400).json({ error: 'A valid reason (min 5 chars) is strictly required for manual review' });
    }

    if (!reviewed_by || typeof reviewed_by !== 'string') {
        return res.status(400).json({ error: 'reviewed_by identifier is required' });
    }

    try {
        const session = await db.kycSession.findUnique({
            where: { id: sessionId, tenant_id: tenantId }
        });

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Hardened Rule: Only 'review_required' sessions can be manually reviewed
        // However, for MVP flexibility if a tenant wants to override a rejected/verified session, 
        // we allow it ONLY if it's explicitly logged. But let's enforce strict flow first.
        if (session.status !== 'review_required') {
            return res.status(400).json({ error: `Cannot manually review a session in '${session.status}' state. Must be 'review_required'.` });
        }

        const previousStatus = session.status;

        // Mutate state
        const updatedSession = await db.kycSession.update({
            where: { id: sessionId },
            data: { status }
        });

        // Write Immutable Audit Log
        await db.auditLog.create({
            data: {
                tenant_id: tenantId,
                session_id: session.id,
                actor: reviewed_by,
                action: 'manual_review',
                previous_state: previousStatus,
                new_state: status,
                reason: reason
            }
        });

        // Enqueue Webhook Update
        try {
            await webhookQueue.add('dispatch', {
                sessionId,
                tenantId,
                status
            });
        } catch (webhookErr) {
            console.error(`[ManualReview] Failed to enqueue webhook dispatch:`, webhookErr);
        }

        res.status(200).json({
            message: 'Manual review submitted successfully',
            session_id: session.id,
            new_status: status,
            reviewed_by,
            reason
        });
    } catch (error) {
        console.error('Manual Review Error:', error);
        res.status(500).json({ error: 'Failed to process manual review' });
    }
};
