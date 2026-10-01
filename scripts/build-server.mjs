import {spawnSync} from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
  stdio: 'inherit', env: {...process.env, BUILD_TARGET: 'server'},
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
await import('./prepare-standalone.mjs');
