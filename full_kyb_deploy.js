const { NodeSSH } = require('node-ssh');
const ssh = new NodeSSH();

async function run() {
    try {
        await ssh.connect({
            host: '164.90.204.53',
            username: 'root',
            password: '"[B4K4~qk~3@a'
        });

        const REMOTE = '/opt/tchedes-frontends/tchedes-dashboard';

        console.log('--- Verifying host path ---');
        let r = await ssh.execCommand(`ls -la ${REMOTE}/components/layout/`);
        console.log(r.stdout);

        // Re-upload everything fresh
        console.log('--- Uploading sidebar.tsx ---');
        await ssh.putFile(
            'C:\\Users\\LENOVO\\Documents\\Harestech\\Tchedes\\tchedes-dashboard\\components\\layout\\sidebar.tsx',
            `${REMOTE}/components/layout/sidebar.tsx`
        );

        await ssh.execCommand(`mkdir -p "${REMOTE}/app/(dashboard)/kyb"`);
        await ssh.execCommand(`mkdir -p "${REMOTE}/app/(dashboard)/kyb/[id]"`);
        await ssh.execCommand(`mkdir -p "${REMOTE}/app/(dashboard)/kyb/create"`);

        console.log('--- Uploading KYB pages ---');
        await ssh.putFile(
            'C:\\Users\\LENOVO\\Documents\\Harestech\\Tchedes\\tchedes-dashboard\\app\\(dashboard)\\kyb\\page.tsx',
            `${REMOTE}/app/(dashboard)/kyb/page.tsx`
        );
        await ssh.putFile(
            'C:\\Users\\LENOVO\\Documents\\Harestech\\Tchedes\\tchedes-dashboard\\app\\(dashboard)\\kyb\\[id]\\page.tsx',
            `${REMOTE}/app/(dashboard)/kyb/[id]/page.tsx`
        );
        await ssh.putFile(
            'C:\\Users\\LENOVO\\Documents\\Harestech\\Tchedes\\tchedes-dashboard\\app\\(dashboard)\\kyb\\create\\page.tsx',
            `${REMOTE}/app/(dashboard)/kyb/create/page.tsx`
        );

        // Verify files landed correctly
        console.log('--- Verifying uploads ---');
        r = await ssh.execCommand(`grep -c KYB ${REMOTE}/components/layout/sidebar.tsx`);
        console.log('KYB in sidebar:', r.stdout);
        r = await ssh.execCommand(`ls ${REMOTE}/app/\\(dashboard\\)/kyb`);
        console.log('KYB folder:', r.stdout);

        // Now force a real no-cache rebuild
        console.log('--- Rebuilding Docker image (no-cache) ---');
        r = await ssh.execCommand(`cd /opt/tchedes-frontends && docker compose build --no-cache tchedes-dashboard 2>&1 | tail -20`);
        console.log(r.stdout);

        console.log('--- Restarting container ---');
        r = await ssh.execCommand(`cd /opt/tchedes-frontends && docker compose up -d --force-recreate tchedes-dashboard 2>&1`);
        console.log(r.stdout);

        console.log('✅ Done!');
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        ssh.dispose();
    }
}
run();
