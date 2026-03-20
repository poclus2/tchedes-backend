const { NodeSSH } = require('node-ssh');
const fs = require('fs');
const ssh = new NodeSSH();

async function run() {
    try {
        await ssh.connect({
            host: '164.90.204.53',
            username: 'root',
            password: '"[B4K4~qk~3@a'
        });

        console.log('--- Finding all references to app-tchedes.dartsia.app ---');
        const res = await ssh.execCommand('grep -rnw "/etc" "/opt" -e "app-tchedes.dartsia.app" > /root/nginx_search.txt');

        const res2 = await ssh.execCommand('cat /root/nginx_search.txt');
        fs.writeFileSync('nginx_routing.txt', res2.stdout);
        console.log('Saved to nginx_routing.txt');

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        ssh.dispose();
    }
}

run();
