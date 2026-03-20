import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

export const webhookQueue = new Queue('webhook-dispatch', {
    connection: redis,
    defaultJobOptions: {
        attempts: 5, // MVP Hardened Requirement: 5 attempts
        backoff: {
            type: 'exponential',
            delay: 5000, // 5s, 25s, 125s...
        },
        removeOnComplete: true,
    },
});
