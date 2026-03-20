import { db } from './src/lib/db';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

function generateTestApiKey() {
    return 'sk_test_' + crypto.randomBytes(24).toString('hex');
}

async function testBusiness() {
    try {
        const passwordHash = await bcrypt.hash('passwd', 10);
        const result = await db.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: {
                    name: 'TestCorp',
                    compliance_mode: 'cloud',
                }
            });

            const apiKey = await tx.apiKey.create({
                data: {
                    tenant_id: tenant.id,
                    type: 'test',
                    prefix: 'sk_test_',
                    key_hash: generateTestApiKey()
                }
            });

            const user = await tx.user.create({
                data: {
                    tenant_id: tenant.id,
                    email: `test_biz_${Date.now()}@example.com`,
                    password_hash: passwordHash,
                    role: 'admin',
                    account_type: 'business',
                }
            });
            return { tenant, user, apiKey };
        });
        console.log('Success', result);
    } catch (e) {
        console.error('Prisma Error Triggered:', e);
    }
}
testBusiness().finally(() => process.exit(0));
