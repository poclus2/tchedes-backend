const { NodeSSH } = require('node-ssh');
const ssh = new NodeSSH();

async function run() {
    try {
        await ssh.connect({
            host: '164.90.204.53',
            username: 'root',
            password: '"[B4K4~qk~3@a'
        });

        console.log('--- Searching for docker-compose.yml ---');
        const findRes = await ssh.execCommand('find /opt /root -name "docker-compose.yml"');
        console.log(findRes.stdout);

        console.log('\n--- Inspecting app-frontend-1 Mounts ---');
        const inspectRes = await ssh.execCommand('docker inspect app-frontend-1 --format "{{.Mounts}}"');
        console.log(inspectRes.stdout);

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        ssh.dispose();
    }
}

run();
