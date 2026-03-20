const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const ssh = new NodeSSH();
const HOST = '164.90.204.53';
const USERNAME = 'root';
const PASSWORD = '"[B4K4~qk~3@a';

async function diagnose() {
    try {
        await ssh.connect({
            host: HOST,
            username: USERNAME,
            password: PASSWORD
        });

        console.log('--- Fetching dashboard logs ---');
        const dashLogs = await ssh.execCommand('docker logs --tail 100 tchedes-dashboard');
        fs.writeFileSync('dash_logs.txt', dashLogs.stdout || dashLogs.stderr);

        console.log('--- Fetching nginx logs ---');
        const nginxLogs = await ssh.execCommand('docker logs --tail 100 app-nginx-1');
        fs.writeFileSync('nginx_logs.txt', nginxLogs.stdout || nginxLogs.stderr);

        console.log('--- Fetching nginx config ---');
        const nginxConf = await ssh.execCommand('docker exec app-nginx-1 cat /etc/nginx/conf.d/tchedes-dashboard.conf');
        fs.writeFileSync('dash_conf.txt', nginxConf.stdout || nginxConf.stderr);

        console.log('--- Inspecting networks ---');
        const netInspect = await ssh.execCommand('docker inspect tchedes-dashboard --format "{{.NetworkSettings.Networks}}"');
        fs.writeFileSync('dash_net.txt', netInspect.stdout);

        const netInspectNginx = await ssh.execCommand('docker inspect app-nginx-1 --format "{{json .NetworkSettings.Networks}}"');
        fs.writeFileSync('nginx_net.txt', netInspectNginx.stdout);

        console.log('All diagnostics saved to local files.');

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        ssh.dispose();
    }
}

diagnose();
