import { FaceMatchService } from './src/services/face.service';
import fs from 'fs';
import path from 'path';

async function testFaceMatch() {
    console.log('🔍 Démarrage du test de Reconnaissance Faciale Local...');

    const testDir = path.join(__dirname, 'test_images');
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir);
    }

    const selfieFile = path.join(testDir, 'selfie.jpg');
    const idPhotoFile = path.join(testDir, 'id_photo.jpg');

    let missing = false;
    if (!fs.existsSync(selfieFile)) {
        console.log('⚠️ Fichier manquant : test_images/selfie.jpg');
        missing = true;
    }
    if (!fs.existsSync(idPhotoFile)) {
        console.log('⚠️ Fichier manquant : test_images/id_photo.jpg');
        missing = true;
    }

    if (missing) {
        console.log('\n👉 Veuillez ajouter "selfie.jpg" et "id_photo.jpg" dans le dossier "test_images" et relancez le script.');
        return;
    }

    console.log(`📸 Images trouvées: selfie.jpg, id_photo.jpg`);
    console.log('⚙️ Comparaison en cours...\n');

    try {
        const result = await FaceMatchService.compareImages(selfieFile, idPhotoFile);

        console.log('\n✅ COMPARAISON TERMINÉE !\n');
        console.log('--- 🧠 RÉSULTAT DU MATCHING ---');
        console.table({
            "Score de ressemblance (%)": result.face_match_score,
            "Seuil requis (%)": result.threshold,
            "Validation (Passed)": result.passed ? 'OUI ✅' : 'NON ❌'
        });

        if (result.error) {
            console.error('⚠️ Erreur rencontrée :', result.error);
        }

    } catch (error) {
        console.error('❌ Erreur lors de la comparaison:', error);
    }
}

testFaceMatch();
