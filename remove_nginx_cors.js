const { NodeSSH } = require('node-ssh');
const fs = require('fs');
const ssh = new NodeSSH();

async function run() {
    try {
        await ssh.connect({
            host: '164.90.204.53',
            username: 'root',
            password: '"[B4K4~qk~3@a'
        });

        console.log('--- Removing duplicate CORS headers from Nginx ---');
        const c = 'app-nginx-1';

        // The exact config but *without* the add_header CORS directives
        const conf = `server {
    listen 80;
    server_name api.dartsia.app;
    client_max_body_size 20M;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name api.dartsia.app;
    client_max_body_size 20M;

    ssl_certificate /etc/nginx/ssl/api_fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/api_privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        # Relying on Node.js backend for CORS headers
        # Forward preflight OPTIONS requests directly to the backend
        if ($request_method = 'OPTIONS') {
            # Removed the short-circuit return 204 so the backend handles OPTIONS
        }

        proxy_pass http://tchedes-api:3000;
        
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_buffering off;
        proxy_read_timeout 120s;
        proxy_connect_timeout 120s;
    }
}
`;

        fs.writeFileSync('/tmp/dartsia_nocors.conf', conf);
        await ssh.putFile('/tmp/dartsia_nocors.conf', '/tmp/dartsia.conf');
        await ssh.execCommand(`docker cp /tmp/dartsia.conf ${c}:/etc/nginx/conf.d/dartsia.conf`);

        console.log('\n--- Reloading Nginx ---');
        const test = await ssh.execCommand(`docker exec ${c} nginx -t`);
        console.log('NGINX TEST:', test.stdout || test.stderr);

        if ((test.stdout + test.stderr).includes('successful')) {
            await ssh.execCommand(`docker exec ${c} nginx -s reload`);
            console.log('✅ NGINX RELOADED! Nginx will pass through backend CORS headers.');
        } else {
            console.log('❌ Nginx test failed.');
        }

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        ssh.dispose();
    }
}

run();
