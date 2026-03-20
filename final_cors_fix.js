// Final CORS Fix Script
// Removes internal conflicts from Nginx container, applies CORS to the real dartsia.conf, reloads

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

        const c = 'app-nginx-1';  // nginx container name

        // Read tchedes-api.conf to understand what it does
        const apiConf = await ssh.execCommand(`docker exec ${c} cat /etc/nginx/conf.d/tchedes-api.conf`);

        // If it has server_name api.dartsia.app (conflicting with dartsia.conf), remove it
        if (apiConf.stdout.includes('api.dartsia.app')) {
            console.log('Removing conflicting tchedes-api.conf...');
            await ssh.execCommand(`docker exec ${c} rm /etc/nginx/conf.d/tchedes-api.conf`);
        } else {
            console.log('tchedes-api.conf does not conflict, keeping it.\n', apiConf.stdout.substring(0, 200));
        }

        // Confirm dartsia.conf has CORS headers
        const dartsiaConf = await ssh.execCommand(`docker exec ${c} cat /etc/nginx/conf.d/dartsia.conf`);
        if (!dartsiaConf.stdout.includes('Access-Control-Allow-Origin')) {
            // Add CORS headers 
            console.log('dartsia.conf missing CORS! Pushing fixed version...');
            const fixed = `server {
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
        add_header 'Access-Control-Allow-Origin' 'https://app-tchedes.dartsia.app' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS, PATCH' always;
        add_header 'Access-Control-Allow-Headers' 'Authorization, Content-Type, X-Requested-With, X-Idempotency-Key, Accept, Origin' always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;

        if ($request_method = 'OPTIONS') {
            return 204;
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
            fs.writeFileSync('/tmp/dartsia_fix.conf', fixed);
            await ssh.putFile('/tmp/dartsia_fix.conf', '/tmp/dartsia.conf');
            await ssh.execCommand(`docker cp /tmp/dartsia.conf ${c}:/etc/nginx/conf.d/dartsia.conf`);
        } else {
            console.log('dartsia.conf already has CORS headers ✓');
        }

        // Test and reload
        const test = await ssh.execCommand(`docker exec ${c} nginx -t`);
        const out = (test.stdout || '') + (test.stderr || '');
        console.log('\nnginx -t:\n', out);

        if (out.includes('successful')) {
            await ssh.execCommand(`docker exec ${c} nginx -s reload`);
            console.log('\n✅ NGINX RELOADED! CORS is live.');
        }

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        ssh.dispose();
    }
}

run();
