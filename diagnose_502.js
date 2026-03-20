const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function diagnose() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });

        const psResult = await ssh.execCommand("docker ps");
        const dashLogs = await ssh.execCommand("docker logs --tail 20 tchedes-dashboard");
        const nginxLogs = await ssh.execCommand("docker logs --tail 20 app-nginx-1");
        // Retrieve any error from nginx error payload
        const nginxError = await ssh.execCommand("docker exec app-nginx-1 tail -n 20 /var/log/nginx/error.log");

        const diag = {
            docker_ps: psResult.stdout,
            dashboard_logs: dashLogs.stdout || dashLogs.stderr,
            nginx_logs: nginxLogs.stdout || nginxLogs.stderr,
            nginx_error_log: nginxError.stdout || nginxError.stderr
        };

        fs.writeFileSync('diag.json', JSON.stringify(diag, null, 2));
        console.log('Saved to diag.json');

    } catch (err) {
        console.error(err);
    } finally {
        ssh.dispose();
    }
}

diagnose();
