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
import kybRoutes from './routes/kyb.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// MVP Hardening: Trust proxy if behind LB
app.set('trust proxy', 1);

// Standard Middlewares
app.use(helmet());
const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*';
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins === '*') {
            callback(null, true);
        } else if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));
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
app.use('/v1/identity/kyc', reviewRoutes);
app.use('/v1/identity/kyb', kybRoutes);
app.use('/v1/hosted', hostedRoutes);

// Global Error Handler
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`[Tchedés] Core API running on port ${PORT}`);
    console.log(`[Tchedés] Environment: ${process.env.NODE_ENV}`);
});
