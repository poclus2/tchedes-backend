import { Router } from 'express';
import { KybController } from '../controllers/kyb.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import multer from 'multer';
import path from 'path';

// Storage configuration for Company Documents (Temporary before S3 upload, just like KYC)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../../uploads'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for company docs
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg' && ext !== '.pdf') {
            return cb(new Error('Only images and PDFs are allowed'));
        }
        cb(null, true);
    }
});

const router = Router();

// 1. Create a KYB Verification Session
router.post('/sessions', authMiddleware, KybController.createSession);

// 2. Upload Company Documents (RCCM, Tax)
router.post('/sessions/:id/documents', authMiddleware, upload.single('file'), KybController.uploadDocument);

// 3. Add Director / UBO
router.post('/sessions/:id/directors', authMiddleware, KybController.addDirector);

// 4. Submit KYB for evaluation
router.post('/sessions/:id/submit', authMiddleware, KybController.submitKYB);

// 5. Get KYB Session Details
router.get('/sessions/:id', authMiddleware, KybController.getSession);

export default router;
