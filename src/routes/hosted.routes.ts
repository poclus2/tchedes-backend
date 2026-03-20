import { Router } from 'express';
import { generateHostedLink, hostedUploadDocument, hostedSubmitSession } from '../controllers/hosted.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { idempotencyMiddleware } from '../middlewares/idempotency.middleware';
import { upload } from '../middlewares/upload.middleware';

const router = Router();

// Server-side issuing of Hosted Links (Requires API Key)
router.post('/verifications', authMiddleware, idempotencyMiddleware, generateHostedLink);

// Client-side execution of Hosted Flow (Requires Hosted JWT)
router.post('/documents', authMiddleware, upload.single('file'), hostedUploadDocument);
router.post('/submit', authMiddleware, hostedSubmitSession);

export default router;
