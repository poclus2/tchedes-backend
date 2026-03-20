const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function diagnoseLoginError() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });

        // We captured the logs earlier but maybe we missed the actual stack trace
        // Let's trigger the 500 error again to make sure it's at the bottom of the logs
        await ssh.execCommand(
            "curl -s -X POST http://localhost:80/v1/auth/login " +
            "-H 'Host: api.dartsia.app' " +
            "-H 'Content-Type: application/json' " +
            "-d '{\"email\":\"test@test.com\",\"password\":\"password123\"}'"
        );

        // Fetch the very end of the API logs to catch the exception crash stack
        const logs = await ssh.execCommand("docker logs --tail 40 tchedes-api");
        console.log("--- FINAL API LOGS ---");
        console.log(logs.stdout || logs.stderr);

        // Also grab the login controller to check for any obvious crashes
        const ctrl = await ssh.execCommand("cat /opt/tchedes-api/src/controllers/auth.controller.ts");

        fs.writeFileSync('diag_login_crash.txt',
            "=== LOGS ===\n" + (logs.stdout || logs.stderr) +
            "\n\n=== CONTROLLER ===\n" + (ctrl.stdout || ctrl.stderr)
        );

    } catch (err) {
        console.error(err);
    } finally {
        ssh.dispose();
    }
}

diagnoseLoginError();
