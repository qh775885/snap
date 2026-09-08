import { spawn, execSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
const devkitBin = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'w64devkit', 'bin');

const newPath = [cargoBin, devkitBin, process.env.PATH].filter(Boolean).join(path.delimiter);
const env = { ...process.env, PATH: newPath };

// 尝试关闭前台冲突进程
try {
    if (process.platform === 'win32') {
        execSync("powershell -NoProfile -Command \"Get-Process -Name 'snap', '快门', 'msedgewebview2' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue\"");
    }
} catch (e) {}

// 执行打包
const cmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const child = spawn(cmd, ['tauri', 'build', '--no-bundle'], {
    stdio: 'inherit',
    env,
    shell: true,
});

child.on('exit', (code) => {
    if (code !== 0) {
        process.exit(code || 1);
    }

    // 复制输出到 release/快门-免安装绿色版
    try {
        const outDir = path.join(process.cwd(), 'release', '快门-免安装绿色版');
        fs.mkdirSync(outDir, { recursive: true });

        const srcExe = path.join(process.cwd(), 'src-tauri', 'target', 'release', 'snap.exe');
        const srcDll = path.join(process.cwd(), 'src-tauri', 'target', 'release', 'WebView2Loader.dll');

        const dstExe = path.join(outDir, '快门.exe');
        const dstDll = path.join(outDir, 'WebView2Loader.dll');

        fs.copyFileSync(srcExe, dstExe);
        if (fs.existsSync(srcDll)) {
            fs.copyFileSync(srcDll, dstDll);
        }

        console.log('\x1b[32m%s\x1b[0m', `\n✔ 免安装纯绿色版已输出至: ${outDir}\n`);
    } catch (err) {
        console.error('复制产物失败:', err);
    }
});
