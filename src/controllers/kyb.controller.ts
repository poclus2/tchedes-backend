import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const db = new PrismaClient();

export class KybController {

    // 1. Create a new KYB Session
    static async createSession(req: Request, res: Response) {
        try {
            const tenant_id = (req as any).tenant_id;
            const {
                company_name,
                country,
                registration_number,
                company_type,
                incorporation_date,
                registered_address
            } = req.body;

            const session = await db.kybSession.create({
                data: {
                    tenant_id,
                    company_name,
                    country,
                    registration_number,
                    company_type,
                    incorporation_date,
                    registered_address,
                    status: 'created'
                }
            });

            // Log Audit
            await db.auditLog.create({
                data: {
                    tenant_id,
                    actor: 'system',
                    action: 'kyb_session_created',
                    new_state: 'created',
                    reason: 'API trigger'
                }
            });

            return res.status(201).json({ kyb_session_id: session.id, status: session.status });

        } catch (error: any) {
            console.error('[KybController] Error creating session:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    // 2. Upload a Company Document (RCCM, Tax)
    static async uploadDocument(req: Request, res: Response) {
        try {
            const tenant_id = (req as any).tenant_id;
            const kyb_session_id = req.params.id;
            const { type } = req.body; // 'rccm' | 'tax'
            const file = req.file;

            if (!file) return res.status(400).json({ error: 'No document file provided.' });
            if (!['rccm', 'tax'].includes(type)) return res.status(400).json({ error: 'Invalid document type. Allowed: rccm, tax.' });

            // Verify session belongs to tenant
            const session = await db.kybSession.findFirst({ where: { id: kyb_session_id, tenant_id } });
            if (!session) return res.status(404).json({ error: 'KYB session not found.' });

            const s3_key = file.path;
            const fileBuffer = require('fs').readFileSync(file.path);
            const sha256_hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

            const doc = await db.kybDocument.create({
                data: {
                    session_id: kyb_session_id,
                    type,
                    s3_key,
                    sha256_hash
                }
            });

            await db.auditLog.create({
                data: {
                    tenant_id,
                    actor: 'system',
                    action: `kyb_document_uploaded_${type}`,
                }
            });

            return res.status(201).json({ document_id: doc.id, type: doc.type });

        } catch (error: any) {
            console.error('[KybController] Error uploading document:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    // 3. Add a Director/UBO (and spawn a KYC session)
    static async addDirector(req: Request, res: Response) {
        try {
            const tenant_id = (req as any).tenant_id;
            const kyb_session_id = req.params.id;
            const { full_name, date_of_birth, nationality, ownership_percentage, user_identity_id } = req.body;

            // Verify KYB session
            const kybSession = await db.kybSession.findFirst({ where: { id: kyb_session_id, tenant_id } });
            if (!kybSession) return res.status(404).json({ error: 'KYB session not found.' });

            // Ensure the user_identity exists (or we create a generic one for this director)
            if (!user_identity_id) return res.status(400).json({ error: 'user_identity_id is required to spawn KYC session.' });

            // Create KYC Session for the Director
            const kycSession = await db.kycSession.create({
                data: {
                    tenant_id,
                    user_identity_id,
                    status: 'created'
                }
            });

            // Create Director link
            const director = await db.kybDirector.create({
                data: {
                    kyb_session_id,
                    kyc_session_id: kycSession.id,
                    full_name,
                    date_of_birth,
                    nationality,
                    ownership_percentage: parseFloat(ownership_percentage)
                }
            });

            await db.auditLog.create({
                data: {
                    tenant_id,
                    actor: 'system',
                    action: 'kyb_director_added',
                    reason: `Director ${full_name} added. KYC Session spawned: ${kycSession.id}`
                }
            });

            return res.status(201).json({
                director_id: director.id,
                kyc_session_id: kycSession.id,
                message: 'Director added. Please proceed to upload IDs to the spawned KYC session.'
            });

        } catch (error: any) {
            console.error('[KybController] Error adding director:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    // 4. Submit KYB for Background Processing
    static async submitKYB(req: Request, res: Response) {
        try {
            const tenant_id = (req as any).tenant_id;
            const kyb_session_id = req.params.id;

            const session = await db.kybSession.findFirst({
                where: { id: kyb_session_id, tenant_id },
                include: { Documents: true, Directors: true }
            });

            if (!session) return res.status(404).json({ error: 'KYB session not found.' });

            if (session.status !== 'created') {
                return res.status(400).json({ error: `Cannot submit KYB. Current status is ${session.status}` });
            }

            if (session.Documents.length === 0) {
                return res.status(400).json({ error: 'Missing company document (e.g. RCCM).' });
            }

            if (session.Directors.length === 0) {
                return res.status(400).json({ error: 'At least one Director/UBO is required.' });
            }

            // Move to processing
            await db.kybSession.update({
                where: { id: kyb_session_id },
                data: { status: 'processing' }
            });

            await db.auditLog.create({
                data: {
                    tenant_id,
                    actor: 'system',
                    action: 'kyb_session_state_change',
                    previous_state: 'created',
                    new_state: 'processing',
                    reason: 'KYB Submitted to OCR Background Engine'
                }
            });

            // TODO: BullMQ Enqueue KYB job
            // import { KybQueue } from '../queues/kyb.queue';
            // await KybQueue.add('verify-kyb', { kyb_session_id, tenant_id });

            return res.status(200).json({ status: 'processing', message: 'KYB session submitted for background verification.' });

        } catch (error: any) {
            console.error('[KybController] Error submitting session:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    // 5. Get KYB Details
    static async getSession(req: Request, res: Response) {
        try {
            const tenant_id = (req as any).tenant_id;
            const kyb_session_id = req.params.id;

            const session = await db.kybSession.findFirst({
                where: { id: kyb_session_id, tenant_id },
                include: {
                    Documents: true,
                    Directors: {
                        include: { KycSession: true }
                    }
                }
            });

            if (!session) return res.status(404).json({ error: 'KYB session not found.' });

            return res.status(200).json(session);

        } catch (error: any) {
            console.error('[KybController] Error fetching session:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}
