const { NodeSSH } = require('node-ssh');
const ssh = new NodeSSH();

async function run() {
    try {
        await ssh.connect({
            host: '164.90.204.53',
            username: 'root',
            password: '"[B4K4~qk~3@a'
        });

        console.log('--- Container Image Names ---');
        const res = await ssh.execCommand('docker ps --format "{{.Image}} -> {{.Names}}"');
        console.log(res.stdout);

        console.log('\n--- Searching for Dockerfiles ---');
        const findRes = await ssh.execCommand('find /opt /root -name "Dockerfile"');
        console.log(findRes.stdout);

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        ssh.dispose();
    }
}

run();
