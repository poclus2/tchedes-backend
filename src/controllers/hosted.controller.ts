import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../lib/db';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_for_dev';
const TOKEN_TTL_MINUTES = 15;

export const generateHostedLink = async (req: Request, res: Response) => {
    const { reference_id, document_type, redirect_url } = req.body;
    const tenantId = req.tenant!.id;

    if (!reference_id || !document_type || !redirect_url) {
        return res.status(400).json({ error: 'Missing reference_id, document_type, or redirect_url' });
    }

    try {
        // Upsert User Identity
        let userIdentity = await db.userIdentity.findFirst({
            where: { tenant_id: tenantId, reference_id }
        });

        if (!userIdentity) {
            userIdentity = await db.userIdentity.create({
                data: { tenant_id: tenantId, reference_id }
            });
        }

        // Create session
        const session = await db.kycSession.create({
            data: {
                tenant_id: tenantId,
                user_identity_id: userIdentity.id,
            }
        });

        // Write Audit Log
        await db.auditLog.create({
            data: {
                tenant_id: tenantId,
                session_id: session.id,
                actor: 'system',
                action: 'hosted_session_created',
                new_state: 'created',
            }
        });

        // Generate Secure JWT Token (expiring in 15 mins)
        const token = jwt.sign(
            {
                session_id: session.id,
                tenant_id: tenantId,
                redirect_url
            },
            JWT_SECRET,
            { expiresIn: `${TOKEN_TTL_MINUTES}m` }
        );

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
        const hosted_url = `${frontendUrl}/verify?token=${token}`;

        res.status(201).json({
            session_id: session.id,
            hosted_url,
            expires_in_minutes: TOKEN_TTL_MINUTES
        });
    } catch (error) {
        console.error('Hosted Link Generation Error:', error);
        res.status(500).json({ error: 'Failed to generate hosted link' });
    }
};

import fs from 'fs';
import { generateHash } from '../middlewares/upload.middleware';
import { kycQueue } from '../queue/kycQueue';

export const hostedUploadDocument = async (req: Request, res: Response) => {
    const sessionId = req.hostedSessionId;
    const tenantId = req.tenantId;
    const { type } = req.body; // 'front' | 'back' | 'selfie'
    const file = req.file;

    if (!sessionId || !tenantId) return res.status(401).json({ error: 'Invalid hosted token context' });
    if (!file || !type || !['front', 'back', 'selfie'].includes(type)) {
        return res.status(400).json({ error: 'Invalid file or type (must be front, back, or selfie)' });
    }

    try {
        const session = await db.kycSession.findUnique({
            where: { id: sessionId, tenant_id: tenantId }
        });

        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.status !== 'created') return res.status(400).json({ error: 'Cannot upload documents unless session is in created state' });

        const buffer = fs.readFileSync(file.path);
        const sha256_hash = generateHash(buffer);

        const existingDoc = await db.document.findFirst({
            where: { session_id: sessionId, sha256_hash }
        });

        if (existingDoc) {
            fs.unlinkSync(file.path);
            return res.status(409).json({ error: 'Duplicate document hash detected for this session' });
        }

        const document = await db.document.create({
            data: { session_id: sessionId, type, s3_key: file.path, sha256_hash }
        });

        res.status(201).json({ document_id: document.id, type, message: 'Uploaded successfully' });
    } catch (error) {
        console.error('Hosted Document Upload Error:', error);
        if (file) fs.unlinkSync(file.path);
        res.status(500).json({ error: 'Failed to upload document' });
    }
};

export const hostedSubmitSession = async (req: Request, res: Response) => {
    const sessionId = req.hostedSessionId;
    const tenantId = req.tenantId;

    if (!sessionId || !tenantId) return res.status(401).json({ error: 'Invalid hosted token context' });

    try {
        const session = await db.kycSession.findUnique({
            where: { id: sessionId, tenant_id: tenantId },
            include: { Documents: true }
        });

        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.status !== 'created') return res.status(400).json({ error: `Session cannot be submitted from state: ${session.status}` });

        // Require front, back, and selfie for MVP demo
        const docTypes = session.Documents.map(d => d.type);
        if (!docTypes.includes('front') || !docTypes.includes('back') || !docTypes.includes('selfie')) {
            return res.status(400).json({ error: 'Missing required documents. Need: front, back, selfie' });
        }

        const updatedSession = await db.kycSession.update({
            where: { id: sessionId },
            data: { status: 'processing' }
        });

        await db.auditLog.create({
            data: {
                tenant_id: tenantId,
                session_id: session.id,
                actor: 'system_hosted',
                action: 'session_submitted',
                previous_state: 'created',
                new_state: 'processing',
            }
        });

        await kycQueue.add('process-kyc', { sessionId: session.id, tenantId: tenantId });

        res.status(202).json({
            message: 'Session submitted for async processing via hosted flow',
            session_id: session.id,
            status: updatedSession.status
        });
    } catch (error) {
        console.error('Hosted Session Submit Error:', error);
        res.status(500).json({ error: 'Failed to submit session' });
    }
};
