import { OCRService } from './src/services/ocr.service';
import { DecisionEngine } from './src/services/decision.service';
import { FaceMatchResult } from './src/services/face.service';

async function runMrzTests() {
    console.log("🧪 Démarrage des tests unitaires MRZ réels (Carte CNI Cameroun Nouvelle Génération)\n");

    // MRZ réel extrait de la photo de la nouvelle CNI camerounaise fournie
    // 3 lignes de 30 caractères chacune => Format TD1
    const mockBackOcrTextWithMRZ = `
NOM DU PERE / FATHER'S NAME
NGOULOURE ALIYOU NJOYA
NOM DE LA MERE / MOTHER'S NAME
YOUMBI POKAM MARIE THERESE
LIEU DE NAISSANCE / PLACE OF BIRTH
YDE - BIYEM ASSI
PROFESSION / OCCUPATION
INFORMATICIEN.NE
DATE DE DELIVRANCE / DATE OF ISSUE
13.03.2025
NUMERO CNI / NIC NUMBER
AA01506396
TAILLE / HEIGHT
1.74 m
I<CMR1001506399AA01506396<<<<<
9606210M3503133CMR<<<<<<<<<<<2
NJOYA<POKAM<<ABDELAZIZ<THIERRY
    `;

    // ============================
    // 1. Test MRZ Extraction
    // ============================
    console.log("--- 1. Test Extraction MRZ depuis l'OCR ---");
    const extractedBack = (OCRService as any).parseRegexMapping(mockBackOcrTextWithMRZ, 'back');
    console.log("🔍 MRZ Détecté:", extractedBack.has_mrz);
    if (extractedBack.has_mrz) {
        console.log("📋 Données MRZ parsées:");
        console.log(`   - Format: ${extractedBack.mrz_data?.format}`);
        console.log(`   - Valide (checksums): ${extractedBack.mrz_data?.valid}`);
        console.log(`   - Prénom: ${extractedBack.mrz_data?.firstName}`);
        console.log(`   - Nom de famille: ${extractedBack.mrz_data?.lastName}`);
        console.log(`   - Numéro de carte: ${extractedBack.mrz_data?.documentNumber}`);
        console.log(`   - Date de naissance: ${extractedBack.mrz_data?.birthDate}`);
        console.log(`   - Date d'expiration: ${extractedBack.mrz_data?.expiryDate}`);
        console.log(`   - Nationalité: ${extractedBack.mrz_data?.nationality}`);
    }

    // ============================
    // 2. Test : Correspondance Parfaite (même nom dans VIZ et MRZ)
    // ============================
    console.log("\n--- 2. Test Decision Engine: Correspondance Parfaite VIZ ↔ MRZ ---");
    const frontOcrMatch = {
        raw_text: "",
        confidence: 92,
        engine_meta: { ocr_provider: "paddleocr", ocr_version: "2.7" },
        parsed_fields: {
            first_name: "ABDELAZIZ THIERRY",
            last_name: "NJOYA POKAM",
            id_number: "AA01506396",
            date_of_birth: "1996-06-21",
            date_of_issue: "2025-03-13",
            date_of_expiry: "2035-03-13"
        }
    };
    const backOcrMatch = {
        raw_text: mockBackOcrTextWithMRZ,
        confidence: 90,
        engine_meta: { ocr_provider: "paddleocr", ocr_version: "2.7" },
        parsed_fields: extractedBack
    };
    const faceMatchValid: FaceMatchResult = { face_match_score: 92, threshold: 85, passed: true };
    const resultMatch = DecisionEngine.evaluate(frontOcrMatch, backOcrMatch, faceMatchValid);
    console.log(`✅ Status: ${resultMatch.final_status} | Confiance Finale: ${resultMatch.final_confidence}%`);
    console.log(`   Raisons:`, resultMatch.reasons);

    // ============================
    // 3. Test : Tentative de fraude (nom discordant entre VIZ et MRZ)
    // ============================
    console.log("\n--- 3. Test Decision Engine: Tentative de fraude (Nom Discordant VIZ vs MRZ) ---");
    const frontOcrFraud = {
        raw_text: "",
        confidence: 92,
        engine_meta: { ocr_provider: "paddleocr", ocr_version: "2.7" },
        parsed_fields: {
            first_name: "JEAN BAPTISTE",    // Different from MRZ
            last_name: "KAMGA FOTSO",       // Different from MRZ
            id_number: "AA01506396",
            date_of_birth: "1996-06-21",
            date_of_issue: "2025-03-13",
            date_of_expiry: "2035-03-13"
        }
    };
    const resultFraud = DecisionEngine.evaluate(frontOcrFraud, backOcrMatch, faceMatchValid);
    console.log(`⚠️  Status: ${resultFraud.final_status} | Confiance Finale: ${resultFraud.final_confidence}%`);
    console.log(`   Raisons:`, resultFraud.reasons);

    // ============================
    // 4. Test : Ancienne CNI (sans MRZ) — doit fonctionner normalement
    // ============================
    console.log("\n--- 4. Test Decision Engine: Ancienne CNI (sans MRZ) ---");
    const backOcrOldCNI = {
        raw_text: "CAMEROUN CAMEROON 860000 YDE-NKOLMESSENG I 26.01.2018 CE05 26.01.2028 20180064554520223",
        confidence: 88,
        engine_meta: { ocr_provider: "paddleocr", ocr_version: "2.7" },
        parsed_fields: { has_mrz: false }
    };
    const frontOcrOldCNI = {
        raw_text: "",
        confidence: 88,
        engine_meta: { ocr_provider: "paddleocr", ocr_version: "2.7" },
        parsed_fields: {
            first_name: "AWA",
            last_name: "ONGUETOU",
            id_number: "20180064554520223",
            date_of_birth: "1990-05-10",
            date_of_issue: "2018-01-26",
            date_of_expiry: "2028-01-26"
        }
    };
    const resultOldCNI = DecisionEngine.evaluate(frontOcrOldCNI, backOcrOldCNI, faceMatchValid);
    console.log(`✅ Status: ${resultOldCNI.final_status} | Confiance Finale: ${resultOldCNI.final_confidence}%`);
    console.log(`   Raisons:`, resultOldCNI.reasons);
}

runMrzTests().catch(console.error);
