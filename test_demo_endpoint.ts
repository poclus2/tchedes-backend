import http from 'http';
import { randomUUID } from 'crypto';

const API_KEY = 'sk_test_harestech_mvp_123';
const IDEMPOTENCY_KEY = randomUUID();

function makeRequest(isSecondTry = false) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/v1/demo/mutative',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Idempotency-Key': IDEMPOTENCY_KEY,
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`\n--- Request ${isSecondTry ? '2 (Replay)' : '1 (Original)'} ---`);
                console.log(`Status Code: ${res.statusCode}`);
                console.log(`Is Replayed (Header): ${res.headers['x-idempotent-replayed'] || 'false'}`);
                console.log(`Body: ${data}`);
                resolve(res.statusCode);
            });
        });

        req.on('error', e => reject(e));
        req.write(JSON.stringify({ testData: 'hello world' }));
        req.end();
    });
}

async function test() {
    console.log(`Starting Test... using Idempotency Key: ${IDEMPOTENCY_KEY}`);

    // Wait a little bit for server to be fully up
    await new Promise(r => setTimeout(r, 2000));

    // Hit endpoints twice to verify idempotency 24h cache working
    await makeRequest(false);
    await makeRequest(true);
}

test().catch(console.error);
