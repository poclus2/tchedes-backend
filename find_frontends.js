const { NodeSSH } = require('node-ssh');
const ssh = new NodeSSH();

async function run() {
    try {
        await ssh.connect({
            host: '164.90.204.53',
            username: 'root',
            password: '"[B4K4~qk~3@a'
        });

        console.log('--- SEARCHING FOR tchedes-frontends ---');
        const search = await ssh.execCommand('find / -maxdepth 3 -type d -name "tchedes-frontends" 2>/dev/null');
        console.log(search.stdout);

    } catch (e) {
        console.error(e);
    } finally {
        ssh.dispose();
    }
}
run();
