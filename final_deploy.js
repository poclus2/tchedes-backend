const { NodeSSH } = require('node-ssh');
const ssh = new NodeSSH();

async function run() {
    try {
        await ssh.connect({
            host: '164.90.204.53',
            username: 'root',
            password: '"[B4K4~qk~3@a'
        });

        const CONTAINER = 'tchedes-dashboard';
        const HOST = '/opt/tchedes-frontends/tchedes-dashboard';

        // Upload fix to host first
        console.log('1. Upload fixed kyb/page.tsx to host...');
        await ssh.putFile(
            'C:\\Users\\LENOVO\\Documents\\Harestech\\Tchedes\\tchedes-dashboard\\app\\(dashboard)\\kyb\\page.tsx',
            `${HOST}/app/(dashboard)/kyb/page.tsx`
        );

        // Copy into container
        console.log('2. Copy into container...');
        let r = await ssh.execCommand(`docker cp "${HOST}/app/(dashboard)/kyb/page.tsx" ${CONTAINER}:"/app/app/(dashboard)/kyb/page.tsx"`);
        console.log(r.stderr || 'ok');

        // Verify no api import
        r = await ssh.execCommand(`docker exec ${CONTAINER} grep -c "from '@/lib/api'" /app/app/\\(dashboard\\)/kyb/page.tsx`);
        console.log('api import count (must be 0):', r.stdout.trim());

        // Run build inside container  
        console.log('3. Running npm run build inside container...');
        r = await ssh.execCommand(`docker exec ${CONTAINER} sh -c "cd /app && npm run build 2>&1 | tail -30"`);
        console.log('Build output:', r.stdout);

        // Check .next was created
        r = await ssh.execCommand(`docker exec ${CONTAINER} ls /app/.next/BUILD_ID`);
        const buildCreated = r.stdout.trim().includes('BUILD_ID');
        console.log('.next/BUILD_ID:', r.stdout.trim() || r.stderr.trim());

        if (!buildCreated) {
            console.error('Build failed — .next/BUILD_ID not found. Cannot proceed.');
            return;
        }

        // Commit container to image
        console.log('4. Committing container as new image...');
        r = await ssh.execCommand(`docker commit ${CONTAINER} tchedes-frontends-tchedes-dashboard`);
        console.log('Committed:', r.stdout.trim());

        // Restart from committed image
        console.log('5. Restarting from committed image...');
        r = await ssh.execCommand(`docker restart ${CONTAINER}`);
        console.log('Restarted:', r.stdout);

        // Wait and verify
        await new Promise(res => setTimeout(res, 5000));
        r = await ssh.execCommand(`docker ps | grep tchedes-dashboard`);
        console.log('Container status:', r.stdout);
        r = await ssh.execCommand(`docker logs --tail 8 ${CONTAINER}`);
        console.log('Logs:', r.stdout || r.stderr);

        console.log('✅ FINAL DEPLOY DONE!');

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        ssh.dispose();
    }
}
run();
