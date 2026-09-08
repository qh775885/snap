// 通用 IPC 桥接层：适配 Tauri 2.0，同时具备 Web 兜底容错
let isTauriEnv = false;
let tauriInvoke = null;
let tauriConvertFileSrc = null;

try {
    // 动态或静态尝试引入 Tauri 2.0 core
    if (window.__TAURI_INTERNALS__ || window.__TAURI__) {
        isTauriEnv = true;
    }
} catch (e) {
    isTauriEnv = false;
}

// 异步载入 Tauri API
let initPromise = null;
async function getTauriCore() {
    if (!initPromise) {
        initPromise = (async () => {
            try {
                const core = await import('@tauri-apps/api/core');
                tauriInvoke = core.invoke;
                tauriConvertFileSrc = core.convertFileSrc;
                isTauriEnv = true;
                return { invoke: tauriInvoke, convertFileSrc: tauriConvertFileSrc };
            } catch (err) {
                console.warn('当前运行于纯 Web 模式或 Tauri API 未就绪:', err);
                isTauriEnv = false;
                return null;
            }
        })();
    }
    return initPromise;
}

export async function selectFolder(defaultPath) {
    const core = await getTauriCore();
    if (core && core.invoke) {
        return await core.invoke('select_folder', { defaultPath: defaultPath || null });
    }
    return null;
}

export async function selectVideoFile() {
    const core = await getTauriCore();
    if (core && core.invoke) {
        return await core.invoke('select_video_file');
    }
    return null;
}

export async function openPath(targetPath) {
    const core = await getTauriCore();
    if (core && core.invoke) {
        return await core.invoke('open_path', { targetPath });
    }
}

export async function saveSnapshot({ outputDir, filePrefix, format, base64Data }) {
    const core = await getTauriCore();
    if (core && core.invoke) {
        return await core.invoke('save_snapshot', {
            outputDir,
            filePrefix: filePrefix || null,
            format: format || 'jpg',
            base64Data,
        });
    }

    // Web 浏览器纯前端兜底：使用 Blob 下载
    return new Promise((resolve) => {
        const link = document.createElement('a');
        const ext = (format || 'jpg').toLowerCase();
        const fileName = `${filePrefix || 'snap'}_${Date.now()}.${ext}`;
        link.href = base64Data;
        link.download = fileName;
        link.click();
        resolve({
            file_path: fileName,
            file_name: fileName,
            timestamp: Date.now(),
        });
    });
}

export async function deleteSnapshot(filePath) {
    const core = await getTauriCore();
    if (core && core.invoke) {
        return await core.invoke('delete_snapshot', { filePath });
    }
    return true;
}

export async function checkMedia(filePath) {
    const core = await getTauriCore();
    if (core && core.invoke) {
        return await core.invoke('check_media_file', { filePath });
    }
    return {
        exists: true,
        extension: filePath.split('.').pop()?.toLowerCase() || '',
        size_bytes: 0,
        is_ts: filePath.toLowerCase().endsWith('.ts'),
    };
}

export function toAssetUrl(filePath) {
    if (!filePath) return '';
    // 如果已经是 http/blob/data，直接使用
    if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('blob:') || filePath.startsWith('data:')) {
        return filePath;
    }
    if (tauriConvertFileSrc) {
        return tauriConvertFileSrc(filePath);
    }
    // Tauri asset 协议标准转换
    try {
        const encoded = encodeURIComponent(filePath.replace(/\\/g, '/')).replace(/%2F/g, '/');
        return `http://asset.localhost/${encoded}`;
    } catch {
        return filePath;
    }
}
