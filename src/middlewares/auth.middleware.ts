import { Request, Response, NextFunction } from 'express';
import { db } from '../lib/db';

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // 1. Check if token is a standard API key
        if (token.startsWith('sk_test_') || token.startsWith('sk_live_')) {
            const apiKey = await db.apiKey.findUnique({
                where: { key_hash: token },
                include: { Tenant: true },
            });

            if (!apiKey) {
                return res.status(401).json({ error: 'Invalid API Key' });
            }

            req.tenant = apiKey.Tenant;
            req.apiKey = apiKey;
            return next();
        }

        // 2. Otherwise assume it's a JWT from the Dashboard OR a Hosted Flow Token
        const jwtSecret = process.env.JWT_SECRET || 'super_secret_tchedes_jwt_key_prod';
        let decoded: any;
        try {
            // Attempt to verify with the primary secret
            decoded = require('jsonwebtoken').verify(token, jwtSecret);
        } catch (e: any) {
            // If primary fails, log specifically why and return 401
            console.log(`[AUTH] Verification failed for token: ${e.message}`);
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // Hosted Flow Token scenario
        if (decoded.session_id) {
            req.hostedSessionId = decoded.session_id;
            req.tenantId = decoded.tenant_id;
            return next();
        }

        // Dashboard User scenario
        const user = await db.user.findUnique({
            where: { id: decoded.userId },
            include: { Tenant: true }
        });

        if (!user) {
            return res.status(401).json({ error: 'User associated with token not found' });
        }

        req.tenant = user.Tenant;
        req.user = user;
        next();
    } catch (error) {
        console.error('Auth Middleware Error:', error);
        res.status(500).json({ error: 'Internal Server Error during authentication' });
    }
};
