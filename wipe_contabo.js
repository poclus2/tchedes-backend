const { NodeSSH } = require('node-ssh');
const ssh = new NodeSSH();

async function run() {
    try {
        await ssh.connect({
            host: '62.169.31.12',
            username: 'root',
            password: 'Vykuj3546'
        });

        console.log('--- WIPING FOLDERS ---');
        await ssh.execCommand('rm -rf /opt/tchedes-dashboard/* /opt/tchedes-backend/*');

        console.log('--- RE-CREATING FOLDERS ---');
        await ssh.execCommand('mkdir -p /opt/tchedes-dashboard /opt/tchedes-backend');

        console.log('--- FOLDERS WIPED. PLEASE PUSH FROM GITHUB NOW ---');
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        ssh.dispose();
    }
}
run();
