import { OCRService } from './src/services/ocr.service';
import fs from 'fs';
import path from 'path';

// Force GCP credentials variable for this script
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(__dirname, 'gcp-key.json');

async function testOCR() {
    console.log('🔍 Démarrage du test OCR Local avec Google Cloud Vision...');
    console.log(`Clé utilisée: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}\n`);

    // We need a test image. Since we don't have one right now, we will ask the user.
    // However, Let's see if there is any image in a 'test_images' folder
    const testDir = path.join(__dirname, 'test_images');
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir);
        console.log('⚠️ Le dossier "test_images" vient d\'être créé.');
        console.log('👉 Mets-y une image d\'une carte d\'identité (ex: cni_front.jpg) et relance le script.');
        return;
    }

    const files = fs.readdirSync(testDir).filter(f => f.match(/\.(jpg|jpeg|png)$/i));

    if (files.length === 0) {
        console.log('⚠️ Le dossier "test_images" est vide.');
        console.log('👉 Mets-y une image d\'une carte d\'identité (ex: cni_front.jpg) et relance le script.');
        return;
    }

    const testFile = path.join(testDir, files[0]);
    console.log(`📸 Image trouvée: ${files[0]}`);
    console.log('⚙️ Extraction en cours via Google Vision...\n');

    try {
        const result = await OCRService.extractCameroonCNI(testFile, 'front');

        console.log('✅ EXTRACTION TERMINÉE !\n');

        console.log('--- 📄 TEXTE BRUT (Raw Text) ---');
        console.log(result.raw_text);

        console.log('\n--- 🧠 CHAMPS PARSÉS (Regex Result) ---');
        console.table(result.parsed_fields);

    } catch (error) {
        console.error('❌ Erreur lors de l\'extraction:', error);
    }
}

testOCR();
