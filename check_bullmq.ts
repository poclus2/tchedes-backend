import { Queue } from 'bullmq';
import { redis } from './src/lib/redis';

async function checkQueue() {
    const q = new Queue('kyc-processing', { connection: redis });
    const waiting = await q.getWaiting();
    const active = await q.getActive();
    const failed = await q.getFailed();
    const completed = await q.getCompleted();

    console.log('--- BullMQ Queue Status ---');
    console.log(`Waiting: ${waiting.length}`);
    console.log(`Active: ${active.length}`);
    console.log(`Failed: ${failed.length}`);
    console.log(`Completed: ${completed.length}`);

    if (failed.length > 0) {
        console.log('--- Latest Failure Reason ---');
        console.log(failed[0].failedReason);
    }

    process.exit(0);
}

checkQueue();
