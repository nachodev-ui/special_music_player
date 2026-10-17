import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
await import('./build-electron.mjs');
const server = await createServer();
await server.listen();
server.printUrls();
const env = { ...process.env, USAGI_DEV_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
async function close() { child.kill(); await server.close(); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
child.on('error', async (error) => { console.error(error); await server.close(); process.exitCode = 1; });
child.on('exit', async (code) => { await server.close(); process.exitCode = code ?? 0; });
