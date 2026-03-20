const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function diagnoseReal502() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });

        console.log('--- PUBLIC CURL ---');
        // Test curl from outside the docker network using the public domain
        const pubCurl = await ssh.execCommand(
            "curl -sI -X POST https://api.dartsia.app/v1/auth/login " +
            "-H 'Origin: https://app-tchedes.dartsia.app' " +
            "-H 'Content-Type: application/json' -d '{}' -m 10"
        );
        console.log(pubCurl.stdout || pubCurl.stderr);

        console.log('\n--- NGINX ERROR.LOG ---');
        // Find where nginx logs errors in this container
        const conf = await ssh.execCommand("docker exec app-nginx-1 cat /var/log/nginx/error.log | tail -n 20");
        console.log(conf.stdout || conf.stderr);

        fs.writeFileSync('diag_real_502.txt',
            "Public Curl:\n" + (pubCurl.stdout || pubCurl.stderr) +
            "\n\nNginx Error.log:\n" + (conf.stdout || conf.stderr)
        );

    } catch (err) {
        console.error(err);
    } finally {
        ssh.dispose();
    }
}

diagnoseReal502();
