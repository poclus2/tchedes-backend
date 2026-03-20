const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function diagnoseEmptyResponse() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });

        console.log('--- NGINX ERRORS ---');
        const nginxError = await ssh.execCommand("docker logs --tail 30 app-nginx-1");
        console.log(nginxError.stdout || nginxError.stderr);

        console.log('\n--- INTERNAL CURL ---');
        const internalCurl = await ssh.execCommand("docker exec app-nginx-1 curl -sI http://tchedes-api:3000/health -m 5");
        console.log("Health:", internalCurl.stdout || internalCurl.stderr);

        const internalPost = await ssh.execCommand(
            "docker exec app-nginx-1 curl -sv -X POST http://tchedes-api:3000/v1/auth/login " +
            "-H 'Content-Type: application/json' -d '{}' -m 5"
        );
        console.log("Post:", internalPost.stdout || internalPost.stderr);

        fs.writeFileSync('diag_empty_resp.txt',
            "Nginx Errors:\n" + (nginxError.stdout || nginxError.stderr) +
            "\n\nInternal GET:\n" + (internalCurl.stdout || internalCurl.stderr) +
            "\n\nInternal POST:\n" + (internalPost.stdout || internalPost.stderr)
        );

    } catch (err) {
        console.error(err);
    } finally {
        ssh.dispose();
    }
}

diagnoseEmptyResponse();
