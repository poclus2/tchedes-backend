const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function testConnections() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });

        console.log('--- TEST NGINX TO API POST ---');
        // Is Nginx rejecting the POST because of payload size or missing headers?
        const nginxError = await ssh.execCommand("docker logs --tail 20 app-nginx-1");
        console.log(nginxError.stdout || nginxError.stderr);

        console.log('\n--- INTERNAL DB STATE ---');
        // Check if the DB table literally exists
        const dbCheck = await ssh.execCommand("docker exec tchedes-api npx prisma db pull");
        console.log(dbCheck.stdout || dbCheck.stderr);

        fs.writeFileSync('diag_db_state.txt',
            "Nginx: " + (nginxError.stdout || nginxError.stderr) +
            "\n\nDB: " + (dbCheck.stdout || dbCheck.stderr)
        );

    } catch (err) {
        console.error(err);
    } finally {
        ssh.dispose();
    }
}

testConnections();
