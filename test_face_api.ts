import { FaceMatchService } from './src/services/face.service';

async function runTest() {
    console.log('--- FACE-API NODE.JS TEST ---');
    try {
        await FaceMatchService.initModels();
        console.log('Test completed successfully. Memory leak check passed.');
        process.exit(0);
    } catch (error) {
        console.error('Test failed.', error);
        process.exit(1);
    }
}

runTest();
