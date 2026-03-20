const { NodeSSH } = require('node-ssh');
const ssh = new NodeSSH();

async function run() {
    try {
        await ssh.connect({
            host: '164.90.204.53',
            username: 'root',
            password: '"[B4K4~qk~3@a'
        });

        console.log('--- DOCKER NGINX CONFIG FILES ---');
        // Retrieve the container ID of nginx
        const dockps = await ssh.execCommand("docker ps --format '{{.Names}}' | grep nginx");
        const nginxContainer = dockps.stdout.trim();

        if (nginxContainer) {
            console.log(`Found Nginx container: ${nginxContainer}`);
            const ls = await ssh.execCommand(`docker exec ${nginxContainer} ls -la /etc/nginx/conf.d/`);
            console.log(ls.stdout);

            console.log('\n--- READING API CONFIG ---');
            const cat = await ssh.execCommand(`docker exec ${nginxContainer} cat /etc/nginx/conf.d/api.conf || docker exec ${nginxContainer} cat /etc/nginx/conf.d/default.conf`);
            console.log(cat.stdout);
        } else {
            console.log('No Nginx container found.');
        }

    } catch (e) {
        console.error('Erreur:', e.message);
    } finally {
        ssh.dispose();
    }
}

run();
