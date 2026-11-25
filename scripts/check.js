// Syntax-checks every JS file under src/ (used by `npm run check` and CI).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
  }
})(path.join(__dirname, '..', 'src'));

for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
execFileSync(process.execPath, ['--test', path.join(__dirname, 'taskbar-recovery.test.js')], { stdio: 'inherit' });
const pkg = require('../package.json');
for (const f of ['src/renderer/bar.html', 'src/renderer/panel.html', 'src/renderer/settings.html', 'src/renderer/assets/icon.png', pkg.main]) {
  if (!fs.existsSync(path.join(__dirname, '..', f))) { console.error('missing', f); process.exit(1); }
}
console.log(`ok: ${files.length} files`);
const tests = fs.readdirSync(__dirname).filter((file) => file.endsWith('.test.js')).map((file) => path.join(__dirname, file));
if (tests.length) execFileSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
