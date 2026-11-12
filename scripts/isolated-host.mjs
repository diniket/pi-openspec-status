// Test-only launcher. Never invokes service controls or reuses live state.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const [hostPackage, sdkPackage, root, role] = process.argv.slice(2);
if (!hostPackage || !sdkPackage || !root || !['web', 'sessiond'].includes(role)) throw new Error('Usage: node scripts/isolated-host.mjs HOST_PACKAGE SDK_PACKAGE ISOLATED_ROOT web|sessiond');
const base = resolve(root);
if (!base.startsWith('/tmp/openspec-')) throw new Error('Only /tmp/openspec-* test roots are supported');
const env = {
  HOME: process.env.HOME, PATH: process.env.PATH,
  PI_WEB_PI_PACKAGE_DIR: resolve(sdkPackage),
  PI_WEB_DATA_DIR: `${base}/data`, PI_WEB_CONFIG: `${base}/config.json`,
  PI_CODING_AGENT_DIR: `${base}/agent`,
  PI_WEB_SESSIOND_SOCKET: `${base}/sessiond.sock`,
  PI_WEB_PORT: '18504', PI_WEB_HOST: '0.0.0.0',
  PI_WEB_INSTANCE_NAMESPACE: 'openspec-consolidation-lab',
  PI_WEB_HOST_ACCESS: JSON.stringify({ mode: 'restricted', hosts: [] }),
  PI_WEB_OFFLINE: '1', PI_OFFLINE: '1',
};
const child = spawn(process.execPath, [resolve(hostPackage, 'dist/server', role === 'web' ? 'index.js' : 'sessiond.js')], { cwd: base, env, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
