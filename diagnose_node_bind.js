const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function diagnoseNodeHost() {
    try {
        await ssh.connect({ host: HOST, username: USERNAME, password: PASSWORD });

        console.log('--- INTERNAL API PING ---');
        // Does the API respond to its own localhost?
        const localhostPing = await ssh.execCommand("docker exec tchedes-api curl -sI http://localhost:3000/health");
        console.log("Localhost:", localhostPing.stdout || localhostPing.stderr);

        // Read the start script & package.json to see the binding
        const pkg = await ssh.execCommand("docker exec tchedes-api cat package.json | grep start");
        console.log("Package config:", pkg.stdout || pkg.stderr);

        // Check if process is still alive inside the container
        const ps = await ssh.execCommand("docker exec tchedes-api ps aux");
        console.log("Processes:", ps.stdout || ps.stderr);

        fs.writeFileSync('diag_node_bind.txt',
            "Localhost: " + (localhostPing.stdout || localhostPing.stderr) +
            "\n\nPkg: " + (pkg.stdout || pkg.stderr) +
            "\n\nPS: " + (ps.stdout || ps.stderr)
        );

    } catch (err) {
        console.error(err);
    } finally {
        ssh.dispose();
    }
}

diagnoseNodeHost();
