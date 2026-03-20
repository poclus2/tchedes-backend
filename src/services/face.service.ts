import * as faceapi from '@vladmandic/face-api';
// Import tfjs for TypeScript type safety (both pure JS and native use the same types)
import * as tf from '@tensorflow/tfjs';
// In production (Linux), load the native tfjs-node backend for ~10x speed.
if (process.env.NODE_ENV === 'production') {
    try { require('@tensorflow/tfjs-node'); } catch (_) { /* fallback to tfjs */ }
}
import * as fs from 'fs';
import * as path from 'path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import sharp from 'sharp';

export interface FaceMatchResult {
    face_match_score: number;
    threshold: number;
    passed: boolean;
    error?: string;
}

export class FaceMatchService {
    private static modelsLoaded = false;
    // Option 3: Threshold lowered from 85 → 78 to be more resilient to low-quality ID photos
    private static readonly THRESHOLD = 78;

    public static async initModels() {
        if (this.modelsLoaded) return;

        try {
            console.log('⏳ Loading Face-API.js AI Models (Native Mode)...');
            const modelPath = path.join(process.cwd(), 'node_modules', '@vladmandic', 'face-api', 'model');

            await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
            await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
            await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);

            this.modelsLoaded = true;
            console.log('✅ Face-API.js AI Models loaded successfully.');
        } catch (error) {
            console.error('❌ Failed to load Face-API models:', error);
            throw error;
        }
    }

    private static imagePathToTensor(imagePath: string): tf.Tensor3D {
        const buffer = fs.readFileSync(imagePath);
        const ext = path.extname(imagePath).toLowerCase();
        let rawImageData: { data: Uint8Array; width: number; height: number };

        if (ext === '.png') {
            const png = PNG.sync.read(buffer);
            rawImageData = { data: new Uint8Array(png.data), width: png.width, height: png.height };
        } else {
            rawImageData = jpeg.decode(buffer, { useTArray: true });
        }

        const numChannels = 4;
        const tensor = tf.tensor3d(rawImageData.data, [rawImageData.height, rawImageData.width, numChannels], 'int32');
        const rgbTensor = tf.slice3d(tensor, [0, 0, 0], [-1, -1, 3]);
        tensor.dispose();

        return rgbTensor;
    }

    /**
     * Option 1: Sharpen the ID photo before face analysis.
     * Uses Unsharp Mask which enhances edges WITHOUT altering colors.
     * We DO NOT sharpen the selfie — it is typically already high quality.
     */
    private static async sharpenIdPhoto(inputPath: string): Promise<string> {
        const parsed = path.parse(inputPath);
        const outputPath = path.join(parsed.dir, `${parsed.name}-sharpened${parsed.ext}`);
        try {
            await sharp(inputPath)
                .sharpen({ sigma: 1.5, m1: 0.5, m2: 0.8 }) // Unsharp mask: preserves color
                .jpeg({ quality: 100 })
                .toFile(outputPath);
            console.log(`[FaceMatch] ✅ ID photo sharpened → ${outputPath}`);
            return outputPath;
        } catch (err) {
            console.error('[FaceMatch] ⚠️  Sharpening failed, falling back to original:', err);
            return inputPath;
        }
    }

    /**
     * Option 2: Extract the detected face bounding box, add padding, and upscale to 400×400.
     * Giving the recognition network a larger, well-framed face region
     * yields a significantly more accurate 128-dimensional descriptor.
     */
    private static async extractUpscaledFace(
        originalPath: string,
        detection: faceapi.WithFaceDescriptor<faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }>>
    ): Promise<string | null> {
        try {
            const box = detection.detection.box;
            const padding = 24; // pixels of context around the face
            const left = Math.max(0, Math.round(box.x - padding));
            const top = Math.max(0, Math.round(box.y - padding));
            const width = Math.round(box.width + padding * 2);
            const height = Math.round(box.height + padding * 2);

            const parsed = path.parse(originalPath);
            const outputPath = path.join(parsed.dir, `${parsed.name}-face-crop.jpg`);

            await sharp(originalPath)
                .extract({ left, top, width, height })
                .resize(400, 400, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
                .jpeg({ quality: 100 })
                .toFile(outputPath);

            console.log(`[FaceMatch] ✅ Face crop extracted and upscaled → 400×400`);
            return outputPath;
        } catch (err) {
            console.error('[FaceMatch] ⚠️  Face crop extraction failed:', err);
            return null;
        }
    }

    static async compareImages(selfiePath: string, idPhotoPath: string): Promise<FaceMatchResult> {
        try {
            await this.initModels();

            // ── Option 1: Sharpen the ID photo ──────────────────────────────────
            const sharpenedIdPath = await this.sharpenIdPhoto(idPhotoPath);

            // ── Analyze Selfie ───────────────────────────────────────────────────
            console.log(`[FaceMatch] Analyzing Selfie: ${selfiePath}`);
            const selfieTensor = this.imagePathToTensor(selfiePath);
            const selfieDetection = await faceapi.detectSingleFace(selfieTensor as any).withFaceLandmarks().withFaceDescriptor();
            selfieTensor.dispose();

            if (!selfieDetection) {
                return { face_match_score: 0, threshold: this.THRESHOLD, passed: false, error: 'No face detected in selfie' };
            }

            // ── Analyze sharpened ID Photo (first pass) ──────────────────────────
            console.log(`[FaceMatch] Analyzing ID card (sharpened): ${sharpenedIdPath}`);
            const idTensor = this.imagePathToTensor(sharpenedIdPath);
            const idDetection = await faceapi.detectSingleFace(idTensor as any).withFaceLandmarks().withFaceDescriptor();
            idTensor.dispose();

            if (!idDetection) {
                return { face_match_score: 0, threshold: this.THRESHOLD, passed: false, error: 'No face detected in ID document' };
            }

            // ── Option 2: Upscale detected face and re-compute descriptor ────────
            let finalIdDescriptor = idDetection.descriptor;
            const faceCropPath = await this.extractUpscaledFace(sharpenedIdPath, idDetection);
            if (faceCropPath) {
                try {
                    const cropTensor = this.imagePathToTensor(faceCropPath);
                    const cropDetection = await faceapi.detectSingleFace(cropTensor as any).withFaceLandmarks().withFaceDescriptor();
                    cropTensor.dispose();
                    if (cropDetection) {
                        finalIdDescriptor = cropDetection.descriptor;
                        console.log('[FaceMatch] ✅ Using refined descriptor from 400×400 face crop.');
                    } else {
                        console.log('[FaceMatch] ⚠️  No face detected in crop, keeping first-pass descriptor.');
                    }
                } catch (_) { /* keep original descriptor on error */ }
            }

            // ── Compute Similarity Score ─────────────────────────────────────────
            const distance = faceapi.euclideanDistance(selfieDetection.descriptor, finalIdDescriptor);
            console.log(`[FaceMatch] Euclidean distance: ${distance.toFixed(4)}`);

            // Distance mapping to percentage score:
            // < 0.4  → excellent match  (90–100%)
            // < 0.5  → good match       (80–89%)
            // < 0.6  → acceptable match (70–79%)
            // ≥ 0.6  → poor match       (< 70%)
            let score = 0;
            if (distance < 0.4) {
                score = 90 + ((0.4 - distance) / 0.4) * 10;
            } else if (distance < 0.5) {
                score = 80 + ((0.5 - distance) / 0.1) * 10;
            } else if (distance < 0.6) {
                score = 70 + ((0.6 - distance) / 0.1) * 10;
            } else {
                score = Math.max(0, 70 - ((distance - 0.6) * 100));
            }

            const finalScore = Math.min(100, Math.max(0, Math.round(score)));
            // Option 3: THRESHOLD is now 78 (see class constant above)
            console.log(`[FaceMatch] Score: ${finalScore}% | Threshold: ${this.THRESHOLD}% | Passed: ${finalScore >= this.THRESHOLD}`);

            return {
                face_match_score: finalScore,
                threshold: this.THRESHOLD,
                passed: finalScore >= this.THRESHOLD
            };

        } catch (error: any) {
            console.error('[FaceMatch] Error comparing images:', error);
            return {
                face_match_score: 0,
                threshold: this.THRESHOLD,
                passed: false,
                error: error.message
            };
        }
    }
}
