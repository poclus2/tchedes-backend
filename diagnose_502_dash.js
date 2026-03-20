const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function diagnose() {
    try {
        await ssh.connect({
            host: HOST,
            username: USERNAME,
            password: PASSWORD
        });

        console.log('--- Checking container status ---');
        const psRes = await ssh.execCommand('docker ps | grep tchedes-dashboard');
        console.log("Dashboard status:", psRes.stdout);

        const nginxPsRes = await ssh.execCommand('docker ps | grep app-nginx-1');
        console.log("Nginx status:", nginxPsRes.stdout);

        console.log('\n--- Checking dashboard logs ---');
        const dashLogs = await ssh.execCommand('docker logs --tail 20 tchedes-dashboard');
        console.log(dashLogs.stdout || dashLogs.stderr);

        console.log('\n--- Checking nginx logs ---');
        const nginxLogs = await ssh.execCommand('docker logs --tail 20 app-nginx-1');
        console.log(nginxLogs.stdout || nginxLogs.stderr);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        ssh.dispose();
    }
}

diagnose();
