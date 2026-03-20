import { Router } from 'express';
import { createSession, uploadDocument, submitSession, getSession, listSessions, getDocumentImage } from '../controllers/kyc.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { idempotencyMiddleware } from '../middlewares/idempotency.middleware';
import { upload } from '../middlewares/upload.middleware';

const router = Router();

// Ensure all identity routes are authenticated
router.use(authMiddleware);

// Session Lifecycle
router.post('/sessions', idempotencyMiddleware, createSession);
router.get('/sessions', listSessions);
router.get('/sessions/:sessionId', getSession);
router.get('/sessions/:sessionId/documents/:documentId/image', getDocumentImage);

// Session Actions
router.post('/sessions/:sessionId/documents', upload.single('file'), uploadDocument);
router.post('/sessions/:sessionId/submit', idempotencyMiddleware, submitSession);

export default router;
