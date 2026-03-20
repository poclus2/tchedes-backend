import { Request, Response, NextFunction } from 'express';
import { redis } from '../lib/redis';

// 24 hours TTL for idempotency keys
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export const idempotencyMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    // Only apply to mutating requests
    if (['GET', 'OPTIONS', 'HEAD'].includes(req.method)) {
        return next();
    }

    const idempotencyKey = req.headers['idempotency-key'];

    if (!idempotencyKey) {
        return res.status(400).json({ error: 'Idempotency-Key header is strictly required for mutating endpoints' });
    }

    // Namespace the key per tenant to prevent collisions between tenants using the same UUID
    const tenantId = req.tenant?.id || 'unknown';
    const redisKey = `idempotent:${tenantId}:${idempotencyKey}`;

    try {
        const existingRaw = await redis.get(redisKey);

        if (existingRaw) {
            const existingResponse = JSON.parse(existingRaw);
            console.log(`[Idempotency] Returning cached response for key: ${idempotencyKey}`);
            // Return the cached response with a specific header indicating this was a replayed identical request
            return res.status(existingResponse.statusCode).set('X-Idempotent-Replayed', 'true').json(existingResponse.body);
        }

        // Capture the original res.json and res.send methods
        const originalJson = res.json.bind(res);

        // Override res.json to cache the response before sending
        res.json = (body: any) => {
            // Only cache successful requests
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const cachePayload = {
                    statusCode: res.statusCode,
                    body,
                };
                // Fire and forget caching to not block response
                redis.setex(redisKey, IDEMPOTENCY_TTL_SECONDS, JSON.stringify(cachePayload)).catch(err => {
                    console.error('[Idempotency] Failed to cache response:', err);
                });
            }
            return originalJson(body);
        };

        next();
    } catch (error) {
        console.error('Idempotency Middleware Error:', error);
        res.status(500).json({ error: 'Internal Server Error during idempotency check' });
    }
};
