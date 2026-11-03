const { access } = require('node:fs/promises');
const { spawn } = require('node:child_process');
const path = require('node:path');
module.exports = async context => {
  const source = path.join(context.packager.projectDir, '.runtime/node_modules');
  const target = path.join(context.appOutDir, 'resources/runtime/node_modules');
  console.log('Copying complete DSH production dependencies');
  await new Promise((resolve, reject) => {
    const child = spawn('robocopy.exe', [source, target, '/E', '/MT:16', '/R:1', '/W:1', '/XJ', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD', path.join(source, 'dsh-pilot'), path.join(source, 'pilot-desktop'), path.join(source, '.bin')], { windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code !== null && code < 8 ? resolve() : reject(new Error(`Runtime copy failed: robocopy ${code}`)));
  });
  await access(path.join(target, '@deepseek-ai/dsh/lib/bin.js'));
  await access(path.join(context.appOutDir, 'resources/runtime/node.exe'));
  console.log('Verified packaged Node and DSH CLI');
};
