const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function diagnoseNetwork() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });

        console.log('--- NGINX PROXY PASS NETWORK CHECK ---');
        // Check if nginx can ping tchedes-api
        const ping = await ssh.execCommand("docker exec app-nginx-1 ping -c 2 tchedes-api");
        console.log("Ping:", ping.stdout || ping.stderr);

        // Check if tchedes-api is actually in the same network
        const net = await ssh.execCommand("docker inspect app-nginx-1 --format '{{json .NetworkSettings.Networks}}'");
        console.log("Nginx Networks:", net.stdout);

        const apiNet = await ssh.execCommand("docker inspect tchedes-api --format '{{json .NetworkSettings.Networks}}'");
        console.log("API Networks:", apiNet.stdout);

        fs.writeFileSync('diag_network.txt',
            "Ping: " + (ping.stdout || ping.stderr) +
            "\n\nNginx Nets: " + net.stdout +
            "\n\nAPI Nets: " + apiNet.stdout
        );

    } catch (err) {
        console.error(err);
    } finally {
        ssh.dispose();
    }
}

diagnoseNetwork();
