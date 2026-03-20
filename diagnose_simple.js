const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function diagnose() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });

        console.log("DOCKER PROCESSES:");
        const ps = await ssh.execCommand("docker ps -a");
        console.log(ps.stdout);

        console.log("\nLOGS OF DASHBOARD:");
        const logs = await ssh.execCommand("docker logs --tail 20 tchedes-dashboard");
        console.log(logs.stdout || logs.stderr);

    } catch (err) {
        console.error(err);
    } finally {
        ssh.dispose();
    }
}

diagnose();
