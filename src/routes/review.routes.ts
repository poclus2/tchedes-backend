import { Router } from 'express';
import { submitManualReview } from '../controllers/review.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { idempotencyMiddleware } from '../middlewares/idempotency.middleware';

const router = Router();

// Apply Auth globally for these routes
router.use(authMiddleware);

// Manual Review Submission
router.post('/sessions/:sessionId/review', idempotencyMiddleware, submitManualReview);

export default router;
