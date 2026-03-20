const { NodeSSH } = require('node-ssh');
const archiver = require('archiver');
const fs = require('fs');
const readline = require('readline');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const REMOTE_DIR = '/opt/tchedes-api';

async function zipDirectory(sourceDir, outPath) {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(outPath);

    return new Promise((resolve, reject) => {
        archive.directory(sourceDir, false, data => {
            // Ignorer les dossiers lourds à recompiler sur le serveur Linux
            if (
                data.name.startsWith('node_modules') ||
                data.name.startsWith('dist') ||
                data.name.startsWith('.git') ||
                data.name.includes('.zip') ||
                data.name === 'crash.log' ||
                data.name === 'e2e_output.txt'
            ) {
                return false;
            }
            return data;
        })
            .on('error', err => reject(err))
            .pipe(stream);

        stream.on('close', () => resolve());
        archive.finalize();
    });
}

console.log('================================================================');
console.log('TCHEDÉS - AUTOMATISATION DE DÉPLOIEMENT DIGITALOCEAN (UBUNTU 22)');
console.log('================================================================\n');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Veuillez entrer le mot de passe SSH pour 164.90.204.53: ', async (password) => {
    rl.close();
    try {
        console.log('\n📦 Zippage du code source (sans node_modules)...');
        await zipDirectory('.', 'deploy.zip');

        console.log('🌐 Connexion SSH en cours...');
        await ssh.connect({
            host: HOST,
            username: USERNAME,
            password: password
        });

        console.log(`🚀 Upload de l'archive vers ${HOST}:${REMOTE_DIR}...`);
        await ssh.execCommand(`mkdir -p ${REMOTE_DIR}`);
        await ssh.putFile('deploy.zip', `${REMOTE_DIR}/deploy.zip`);

        console.log('⚙️  Extraction et Compilation Native Docker (peut prendre 3-4 minutes)...');
        console.log('   (Cette étape compile le C++ pour Face-API et TensorFlow sur Ubuntu)');

        const result = await ssh.execCommand(`
      cd ${REMOTE_DIR} &&
      apt-get install unzip -y &&
      unzip -o deploy.zip &&
      docker compose down &&
      docker compose build --no-cache &&
      docker compose up -d
    `);

        console.log('\n--- Résultat Docker Compose ---');
        console.log(result.stdout);
        if (result.stderr) console.log(result.stderr);

        console.log('\n✅ DÉPLOIEMENT TERMINÉ AVEC SUCCÈS !');
        console.log('L\'API tourne en arrière-plan sur le port 3000 du Droplet.');
    } catch (err) {
        console.error('\n❌ Erreur de déploiement:', err.message);
    } finally {
        ssh.dispose();
        if (fs.existsSync('deploy.zip')) fs.unlinkSync('deploy.zip');
    }
});
