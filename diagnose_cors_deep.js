const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function fixAll() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });

        // Step 1: Check what env vars the running API container actually sees
        console.log('=== CHECKING RUNNING CONTAINER ENV ===');
        const env = await ssh.execCommand("docker exec tchedes-api env | grep -E 'CORS|REDIS|NODE'");
        console.log(env.stdout || env.stderr);

        // Step 2: Check what the source file on the server really looks like
        console.log('\n=== CHECKING SERVER INDEX.TS ===');
        const idx = await ssh.execCommand("cat /opt/tchedes-api/src/index.ts | head -40");
        console.log(idx.stdout || idx.stderr);

        // Step 3: Test from INSIDE the container directly on port 3000
        console.log('\n=== INTERNAL PREFLIGHT TEST ===');
        const internal = await ssh.execCommand(
            "curl -sI -X OPTIONS http://localhost:3000/v1/auth/login " +
            "-H 'Origin: https://app-tchedes.dartsia.app' " +
            "-H 'Access-Control-Request-Method: POST'"
        );
        const internalResult = internal.stdout || internal.stderr;
        fs.writeFileSync('internal_cors.txt', internalResult);
        console.log(internalResult);

    } catch (err) {
        console.error(err);
    } finally {
        ssh.dispose();
    }
}

fixAll();
