const { NodeSSH } = require('node-ssh');
const ssh = new NodeSSH();

async function run() {
    try {
        await ssh.connect({
            host: '164.90.204.53',
            username: 'root',
            password: '"[B4K4~qk~3@a'
        });

        const script = `#!/bin/bash
set -e  
# Write results, one command at a time
echo "HOST sidebar KYB:" > /opt/sc.txt
grep -c "KYB" /opt/tchedes-frontends/tchedes-dashboard/components/layout/sidebar.tsx >> /opt/sc.txt 2>&1 || echo "0 or error" >> /opt/sc.txt

echo "CONTAINER sidebar KYB:" >> /opt/sc.txt
docker exec tchedes-dashboard sh -c "grep -c KYB /app/components/layout/sidebar.tsx" >> /opt/sc.txt 2>&1 || echo "0 or error" >> /opt/sc.txt

echo "HOST kyb folder:" >> /opt/sc.txt
ls /opt/tchedes-frontends/tchedes-dashboard/app/\\(dashboard\\)/kyb 2>&1 >> /opt/sc.txt || echo "not found" >> /opt/sc.txt

echo "CONTAINER kyb folder:" >> /opt/sc.txt
docker exec tchedes-dashboard sh -c "ls /app/app/\\(dashboard\\)/kyb" >> /opt/sc.txt 2>&1 || echo "not found" >> /opt/sc.txt

echo "DOCKERIGNORE:" >> /opt/sc.txt
cat /opt/tchedes-frontends/tchedes-dashboard/.dockerignore >> /opt/sc.txt 2>&1 || echo "no dockerignore" >> /opt/sc.txt
`;
        await ssh.execCommand(`cat > /opt/sc.sh << 'SCEOF'\n${script}\nSCEOF`);
        await ssh.execCommand('chmod +x /opt/sc.sh');
        await ssh.execCommand('/opt/sc.sh');
        await ssh.getFile('c:/Users/LENOVO/Documents/Harestech/Tchedes/tchedes-core-api/sc.txt', '/opt/sc.txt');
        console.log("Downloaded sc.txt");
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        ssh.dispose();
    }
}
run();
