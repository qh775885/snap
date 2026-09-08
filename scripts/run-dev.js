import { spawn } from 'child_process';
import path from 'path';
import os from 'os';

const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
const devkitBin = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'w64devkit', 'bin');

const newPath = [cargoBin, devkitBin, process.env.PATH].filter(Boolean).join(path.delimiter);
const env = { ...process.env, PATH: newPath };

const cmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const child = spawn(cmd, ['tauri', 'dev'], {
    stdio: 'inherit',
    env,
    shell: true,
});

child.on('exit', (code) => {
    process.exit(code || 0);
});
