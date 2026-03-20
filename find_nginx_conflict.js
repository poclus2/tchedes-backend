const { NodeSSH } = require('node-ssh');
const ssh = new NodeSSH();

async function run() {
    try {
        await ssh.connect({
            host: '164.90.204.53',
            username: 'root',
            password: '"[B4K4~qk~3@a'
        });

        const dockps = await ssh.execCommand("docker ps --format '{{.Names}}' | grep nginx");
        const nginxContainer = dockps.stdout.trim();

        if (nginxContainer) {
            console.log('--- NGINX FILES CONTAINING api.dartsia.app ---');
            const search = await ssh.execCommand(`docker exec ${nginxContainer} grep -rl "api.dartsia.app" /etc/nginx/`);
            console.log(search.stdout);

            console.log('--- NGINX CONFIG TEST ERROR ---');
            const test = await ssh.execCommand(`docker exec ${nginxContainer} nginx -t`);
            console.log("STDOUT:\n", test.stdout);
            console.log("STDERR:\n", test.stderr);
        }
    } catch (e) {
        console.error('Erreur:', e.message);
    } finally {
        ssh.dispose();
    }
}

run();
