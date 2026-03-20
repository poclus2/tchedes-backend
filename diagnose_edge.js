const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function diagnoseEdge() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });

        console.log('--- TEST NGINX FROM OUTSIDE (localhost mapped to 443) ---');
        // We curl the public interface but locally to bypass Cloudflare and hit Nginx directly
        const directNginx = await ssh.execCommand(
            "curl -svk -X POST https://localhost:443/v1/auth/login " +
            "-H 'Host: api.dartsia.app' " +
            "-H 'Content-Type: application/json' -d '{}' -m 5"
        );
        console.log("Direct Nginx:", directNginx.stdout || directNginx.stderr);

        console.log('\n--- NGINX ERRORS RECHECK ---');
        const nginxErr = await ssh.execCommand("docker logs --tail 20 app-nginx-1");
        console.log(nginxErr.stdout || nginxErr.stderr);

        fs.writeFileSync('diag_edge.txt',
            "Direct Nginx:\n" + (directNginx.stdout || directNginx.stderr) +
            "\n\nNginx App Logs:\n" + (nginxErr.stdout || nginxErr.stderr)
        );

    } catch (err) {
        console.error(err);
    } finally {
        ssh.dispose();
    }
}

diagnoseEdge();
