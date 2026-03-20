import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../lib/db';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_tchedes_jwt_key_for_dev_only';
const JWT_EXPIRES_IN = '24h';

// Helper to generate a test API key for new tenants
function generateTestApiKey() {
    return 'sk_test_' + crypto.randomBytes(24).toString('hex');
}

export const registerBusiness = async (req: Request, res: Response) => {
    try {
        const { companyName, email, password, role } = req.body;

        if (!companyName || !email || !password || !role) {
            return res.status(400).json({ error: 'Missing required fields for business registration' });
        }

        const existingUser = await db.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(409).json({ error: 'User already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        // Transaction: Create Tenant, ApiKey, and User
        const result = await db.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: {
                    name: companyName,
                    compliance_mode: 'cloud',
                }
            });

            const apiKey = await tx.apiKey.create({
                data: {
                    tenant_id: tenant.id,
                    type: 'test',
                    prefix: 'sk_test_',
                    key_hash: generateTestApiKey() // In prod, we'd hash this properly
                }
            });

            const user = await tx.user.create({
                data: {
                    tenant_id: tenant.id,
                    email,
                    password_hash: passwordHash,
                    role,
                    account_type: 'business',
                }
            });

            return { tenant, user, apiKey };
        });

        const token = jwt.sign(
            { userId: result.user.id, tenantId: result.tenant.id, role: result.user.role },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.status(201).json({
            message: 'Business account created successfully',
            token,
            user: {
                id: result.user.id,
                email: result.user.email,
                role: result.user.role,
                account_type: result.user.account_type
            }
        });
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ error: 'Internal Server Error during registration' });
    }
};

export const registerIndividual = async (req: Request, res: Response) => {
    try {
        const { firstName, lastName, email, password } = req.body;

        if (!firstName || !lastName || !email || !password) {
            return res.status(400).json({ error: 'Missing required fields for individual registration' });
        }

        const existingUser = await db.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(409).json({ error: 'User already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        // Transaction: Create Tenant (Personal), ApiKey, and User
        const result = await db.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: {
                    name: `${firstName} ${lastName} (Personal)`,
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
                    email,
                    password_hash: passwordHash,
                    first_name: firstName,
                    last_name: lastName,
                    role: 'admin',
                    account_type: 'individual',
                }
            });

            return { tenant, user, apiKey };
        });

        const token = jwt.sign(
            { userId: result.user.id, tenantId: result.tenant.id, role: result.user.role },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.status(201).json({
            message: 'Individual account created successfully',
            token,
            user: {
                id: result.user.id,
                email: result.user.email,
                first_name: result.user.first_name,
                last_name: result.user.last_name,
                role: result.user.role,
                account_type: result.user.account_type
            }
        });
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ error: 'Internal Server Error during registration' });
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await db.user.findUnique({
            where: { email },
            include: { Tenant: true }
        });

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
            { userId: user.id, tenantId: user.tenant_id, role: user.role },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.status(200).json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role,
                account_type: user.account_type,
                tenant_name: user.Tenant.name
            }
        });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'Internal Server Error during login' });
    }
};
