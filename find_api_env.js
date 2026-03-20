const { NodeSSH } = require('node-ssh');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function fix() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });
        console.log('✅ Connecté\n');

        // Find the actual .env used by the API
        console.log('=== localisation du .env API ===');
        const findEnv = await ssh.execCommand('find /root /opt -name ".env" 2>/dev/null | grep -v node_modules | head -10');
        console.log(findEnv.stdout || 'Rien trouvé');

        // Get docker-compose location for the API
        const findDc = await ssh.execCommand('find /root /opt -name "docker-compose.yml" 2>/dev/null | head -5');
        console.log('\n=== docker-compose.yml trouvés ===');
        console.log(findDc.stdout);

        // Read the main docker-compose  
        const dcContent = await ssh.execCommand('cat /root/app/docker-compose.yml 2>/dev/null');
        console.log('\n=== /root/app/docker-compose.yml ===');
        console.log(dcContent.stdout || 'Not found');

        // Check container name of the API
        const containers = await ssh.execCommand('docker ps --format "{{.Names}}" | grep -i api');
        console.log('\n=== API container name ===');
        console.log(containers.stdout);

        // Check if FRONTEND_URL exists in .env
        const checkVar = await ssh.execCommand('grep -r "FRONTEND_URL" /root /opt 2>/dev/null | grep -v node_modules | grep -v ".git"');
        console.log('\n=== FRONTEND_URL occurrences ===');
        console.log(checkVar.stdout || 'Variable absente sur le serveur');

    } catch (err) {
        console.error('Erreur:', err.message);
    } finally {
        ssh.dispose();
    }
}

fix();
