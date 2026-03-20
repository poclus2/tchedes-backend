import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

export const kycQueue = new Queue('kyc-processing', {
    connection: redis,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000,
        },
        removeOnComplete: true,
    },
});
