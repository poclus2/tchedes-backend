import { Tenant, ApiKey, User } from '@prisma/client';

declare global {
    namespace Express {
        interface Request {
            tenant?: Tenant;
            apiKey?: ApiKey;
            user?: User;
            hostedSessionId?: string;
            tenantId?: string; // Sometimes we only have the ID from JWT
        }
    }
}
