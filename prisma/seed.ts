import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Clearing old data...');
    await prisma.auditLog.deleteMany();
    await prisma.document.deleteMany();
    await prisma.kycSession.deleteMany();
    await prisma.userIdentity.deleteMany();
    await prisma.webhookEndpoint.deleteMany();
    await prisma.apiKey.deleteMany();
    await prisma.tenant.deleteMany();

    console.log('Seeding MVP Test Tenant...');

    const tenant = await prisma.tenant.create({
        data: {
            name: 'Harestech Demo Tenant',
            compliance_mode: 'cloud',
            feature_flags: {
                enable_hosted_flow: true,
            },
            ApiKeys: {
                create: [
                    {
                        key_hash: 'sk_test_harestech_mvp_123',
                        type: 'test',
                        prefix: 'sk_test_',
                    },
                    {
                        key_hash: 'sk_live_harestech_mvp_999',
                        type: 'live',
                        prefix: 'sk_live_',
                    },
                ],
            },
            WebhookEndpoints: {
                create: [
                    {
                        url: 'http://localhost:8080/webhook',
                        active: true
                    }
                ]
            }
        },
        include: {
            ApiKeys: true,
            WebhookEndpoints: true
        },
    });

    console.log('✅ Seed successful!');
    console.log('===============================');
    console.log(`Tenant: ${tenant.name}`);
    console.log(`Test API Key: ${tenant.ApiKeys.find(k => k.type === 'test')?.key_hash}`);
    console.log(`Live API Key: ${tenant.ApiKeys.find(k => k.type === 'live')?.key_hash}`);
    console.log('===============================');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
