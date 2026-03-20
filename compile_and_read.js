const { execSync } = require('child_process');
try {
    const out = execSync('node dist/worker.js');
    console.log(out.toString());
} catch (e) {
    console.log(e.stderr.toString());
}
