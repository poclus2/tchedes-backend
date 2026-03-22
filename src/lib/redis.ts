import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379');

export const redis = new Redis({
    host: redisHost,
    port: redisPort,
    maxRetriesPerRequest: null,
});

redis.on('error', (err) => {
    console.error('Redis connection error:', err);
});
