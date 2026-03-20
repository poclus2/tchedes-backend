const { NodeSSH } = require('node-ssh');
const ssh = new NodeSSH();

async function run() {
    try {
        await ssh.connect({
            host: '164.90.204.53',
            username: 'root',
            password: '"[B4K4~qk~3@a'
        });

        console.log('--- Checking /opt/tchedes-frontends/tchedes-dashboard/app/(dashboard)/sessions/[id]/page.tsx ---');
        const res = await ssh.execCommand('head -n 10 /opt/tchedes-frontends/tchedes-dashboard/app/(dashboard)/sessions/[id]/page.tsx');
        console.log(res.stdout);

        console.log('\n--- Checking for Material Symbols import ---');
        const grepRes = await ssh.execCommand('grep -c "Material Symbols" /opt/tchedes-frontends/tchedes-dashboard/app/layout.tsx');
        console.log('Count:', grepRes.stdout);

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        ssh.dispose();
    }
}

run();
