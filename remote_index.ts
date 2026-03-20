import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import { authMiddleware } from './middlewares/auth.middleware';
import { idempotencyMiddleware } from './middlewares/idempotency.middleware';
import { errorHandler } from './middlewares/error.middleware';
import { redis } from './lib/redis';
import { db } from './lib/db';
import kycRoutes from './routes/kyc.routes';
import hostedRoutes from './routes/hosted.routes';
import reviewRoutes from './routes/review.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// MVP Hardening: Trust proxy if behind LB
app.set('trust proxy', 1);

// Standard Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Health Check Endpoint (No Auth)
app.get('/health', async (req, res) => {
    try {
        // Attempt non-blocking assertions
        const dbCheck = await db.$queryRaw`SELECT 1`.catch(() => false);
        const redisCheck = await redis.ping().then(res => res === 'PONG').catch(() => false);

        if (dbCheck && redisCheck) {
            res.status(200).json({ status: 'ok', db: 'connected', redis: 'connected' });
        } else {
            res.status(500).json({ status: 'degraded', db: !!dbCheck, redis: !!redisCheck });
        }
    } catch (err) {
        res.status(500).json({ status: 'down' });
    }
});

// Demo Protected + Idempotent Route
app.post('/v1/demo/mutative', authMiddleware, idempotencyMiddleware, (req, res) => {
    // This route uses idempotency. Try hitting it twice with the same Idempotency-Key Header
    res.status(201).json({
        message: 'Action completed successfully.',
        tenant: req.tenant?.name,
        timestamp: new Date().toISOString()
    });
});

import authRoutes from './routes/auth.routes';

// App Routes
app.use('/v1/auth', authRoutes);
app.use('/v1/identity/kyc', kycRoutes);
app.use('/v1/hosted', hostedRoutes);
app.use('/v1/identity/kyc', reviewRoutes);

// Global Error Handler
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`[Tchedés] Core API running on port ${PORT}`);
    console.log(`[Tchedés] Environment: ${process.env.NODE_ENV}`);
});