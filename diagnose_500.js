const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function diagnose500() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });

        // Check logs for "Login Error:"
        console.log('--- API ERROR LOGS ---');
        const logs = await ssh.execCommand("docker logs tchedes-api --tail 100 | grep -A 10 'Login Error'");
        console.log(logs.stdout || logs.stderr);

        fs.writeFileSync('diag_500_cause.txt', logs.stdout || logs.stderr);

    } catch (err) {
        console.error(err);
    } finally {
        ssh.dispose();
    }
}

diagnose500();
