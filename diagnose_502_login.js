const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function diagnose502() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });

        console.log('--- FETCHING API LOGS ---');
        const apiLogs = await ssh.execCommand("docker logs --tail 100 tchedes-api");

        console.log('\n--- FETCHING NGINX LOGS ---');
        const nginxLogs = await ssh.execCommand("docker logs --tail 50 app-nginx-1");

        fs.writeFileSync('diag_502_logs.txt',
            "=== API LOGS ===\n" + (apiLogs.stdout || apiLogs.stderr) +
            "\n\n=== NGINX LOGS ===\n" + (nginxLogs.stdout || nginxLogs.stderr)
        );
        console.log("Logs saved to diag_502_logs.txt");

    } catch (err) {
        console.error(err);
    } finally {
        ssh.dispose();
    }
}

diagnose502();
