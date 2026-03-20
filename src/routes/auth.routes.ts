import { Router } from 'express';
import { registerBusiness, registerIndividual, login } from '../controllers/auth.controller';

const router = Router();

router.post('/register/business', registerBusiness);
router.post('/register/individual', registerIndividual);
router.post('/login', login);

export default router;
