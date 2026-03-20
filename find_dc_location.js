const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function fix() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });
        console.log('✅ Connecté\n');

        // Find all docker-compose files on the server
        const findAll = await ssh.execCommand('find / -name "docker-compose.yml" -o -name "docker-compose.yaml" 2>/dev/null | grep -v "proc\\|sys\\|devnull" | head -20');
        console.log('=== Tous les docker-compose ===');
        console.log(findAll.stdout);
        fs.writeFileSync('./find_dc_result.txt', findAll.stdout);

        // Check current container inspection to find its startup env
        const inspect = await ssh.execCommand('docker inspect tchedes-api 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); env=d[0][\'Config\'][\'Env\']; [print(e) for e in env if \'FRONTEND\' in e or \'DATABASE\' in e or \'JWT\' in e or \'PORT\' in e]" 2>/dev/null');
        console.log('\n=== ENV tchedes-api (inspect) ===');
        console.log(inspect.stdout || 'Pas de résultat');

        // Get the Labels to find the compose project
        const labels = await ssh.execCommand('docker inspect tchedes-api 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); labels=d[0][\'Config\'][\'Labels\']; [print(k,\'=\',v) for k,v in labels.items()]" 2>/dev/null');
        console.log('\n=== LABELS tchedes-api ===');
        console.log(labels.stdout || 'Pas de résultat');

    } catch (err) {
        console.error('Erreur:', err.message);
    } finally {
        ssh.dispose();
    }
}

fix();
