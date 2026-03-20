import { Request, Response } from 'express';
import { db } from '../lib/db';
import { generateHash } from '../middlewares/upload.middleware';
import { kycQueue } from '../queue/kycQueue';
import fs from 'fs';

export const createSession = async (req: Request, res: Response) => {
    const { reference_id, document_type } = req.body;
    const tenantId = req.tenant?.id || req.tenantId;

    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

    if (!reference_id || !document_type) {
        return res.status(400).json({ error: 'Missing reference_id or document_type' });
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

        // Create session (default status 'created')
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
                action: 'session_created',
                new_state: 'created',
            }
        });

        // Generate Hosted Link (mocked for now, implemented fully in Hosted Flow Task)
        const hosted_url = `http://localhost:5173/verify/${session.id}`;

        res.status(201).json({
            session_id: session.id,
            status: session.status,
            hosted_url
        });
    } catch (error) {
        console.error('Session Creation Error:', error);
        res.status(500).json({ error: 'Failed to create session' });
    }
};

export const uploadDocument = async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const { type } = req.body; // 'front' | 'back' | 'selfie'
    const file = req.file;

    if (!file || !type || !['front', 'back', 'selfie'].includes(type)) {
        return res.status(400).json({ error: 'Invalid file or type (must be front, back, or selfie)' });
    }

    const tenantId = req.tenant?.id || req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const session = await db.kycSession.findUnique({
            where: { id: sessionId, tenant_id: tenantId }
        });

        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.status !== 'created') return res.status(400).json({ error: 'Cannot upload documents unless session is in created state' });

        // Read file and hash
        const buffer = fs.readFileSync(file.path);
        const sha256_hash = generateHash(buffer);

        // Hardened check: Reject duplicate hash on SAME session
        const existingDoc = await db.document.findFirst({
            where: { session_id: sessionId, sha256_hash }
        });

        if (existingDoc) {
            // Cleanup dup local file
            fs.unlinkSync(file.path);
            return res.status(409).json({ error: 'Duplicate document hash detected for this session' });
        }

        // Insert Document
        const document = await db.document.create({
            data: {
                session_id: sessionId,
                type,
                s3_key: file.path, // We store local path as s3_key in MVP
                sha256_hash
            }
        });

        res.status(201).json({ document_id: document.id, type, message: 'Uploaded successfully' });
    } catch (error) {
        console.error('Document Upload Error:', error);
        if (file) fs.unlinkSync(file.path);
        res.status(500).json({ error: 'Failed to upload document' });
    }
};

export const submitSession = async (req: Request, res: Response) => {
    const { sessionId } = req.params;

    const tenantId = req.tenant?.id || req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const session = await db.kycSession.findUnique({
            where: { id: sessionId, tenant_id: tenantId },
            include: { Documents: true }
        });

        if (!session) return res.status(404).json({ error: 'Session not found' });

        if (session.status !== 'created') {
            return res.status(400).json({ error: `Session cannot be submitted from state: ${session.status}` });
        }

        // Ensure we have Front, Back, and Selfie
        const docTypes = session.Documents.map(d => d.type);
        if (!docTypes.includes('front') || !docTypes.includes('back') || !docTypes.includes('selfie')) {
            return res.status(400).json({ error: 'Missing required documents. Need: front, back, selfie' });
        }

        // Mutate state to processing
        const updatedSession = await db.kycSession.update({
            where: { id: sessionId },
            data: { status: 'processing' }
        });

        // Write Audit Log
        await db.auditLog.create({
            data: {
                tenant_id: session.tenant_id,
                session_id: session.id,
                actor: 'system',
                action: 'session_submitted',
                previous_state: 'created',
                new_state: 'processing',
            }
        });

        // Enqueue job to background worker
        await kycQueue.add('process-kyc', { sessionId: session.id, tenantId: session.tenant_id });

        res.status(202).json({
            message: 'Session submitted for async processing',
            session_id: session.id,
            status: updatedSession.status
        });
    } catch (error) {
        console.error('Session Submit Error:', error);
        res.status(500).json({ error: 'Failed to submit session' });
    }
};

export const getSession = async (req: Request, res: Response) => {
    const { sessionId } = req.params;

    const tenantId = req.tenant?.id || req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const session = await db.kycSession.findUnique({
            where: { id: sessionId, tenant_id: tenantId },
            include: { Documents: { select: { id: true, type: true, createdAt: true } } }
        });

        if (!session) return res.status(404).json({ error: 'Session not found' });

        res.status(200).json(session);
    } catch (error) {
        console.error('Session Get Error:', error);
        res.status(500).json({ error: 'Failed to fetch session' });
    }
};

export const listSessions = async (req: Request, res: Response) => {
    const tenantId = req.tenant?.id || req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const sessions = await db.kycSession.findMany({
            where: { tenant_id: tenantId },
            include: {
                UserIdentity: { select: { reference_id: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Transform the data slightly for the frontend dashboard
        const formattedSessions = sessions.map(s => ({
            id: s.id,
            reference_id: s.UserIdentity.reference_id,
            status: s.status,
            confidence_score: null, // Depending on if we added this field to KycSession
            created_at: s.createdAt
        }));

        res.status(200).json(formattedSessions);
    } catch (error) {
        console.error('List Sessions Error:', error);
        res.status(500).json({ error: 'Failed to list sessions' });
    }
};

export const getDocumentImage = async (req: Request, res: Response) => {
    const { sessionId, documentId } = req.params;

    const tenantId = req.tenant?.id || req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const session = await db.kycSession.findUnique({
            where: { id: sessionId, tenant_id: tenantId },
            include: { Documents: true }
        });

        if (!session) return res.status(404).json({ error: 'Session not found' });

        const document = session.Documents.find(d => d.id === documentId);
        if (!document) return res.status(404).json({ error: 'Document not found' });

        const filePath = document.s3_key;
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        res.sendFile(filePath);
    } catch (error) {
        console.error('Get Document Image Error:', error);
        res.status(500).json({ error: 'Failed to fetch document image' });
    }
};
