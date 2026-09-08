import React, { useState, useEffect, useCallback } from 'react';
import { Camera, FolderOpen, Video, Maximize2, Crop } from 'lucide-react';
import { VideoStage } from './components/VideoStage';
import { Gallery } from './components/Gallery';
import { selectFolder, selectVideoFile, saveSnapshot, deleteSnapshot, toAssetUrl, setupNativeFileDrop } from './bridge';

export function App() {
    // 当前视频源
    const [videoSource, setVideoSource] = useState(null);
    const [videoMeta, setVideoMeta] = useState({ name: '', width: 0, height: 0, duration: 0 });

    // 构图模式：默认 'full' (截取全屏原图)，支持 '9:16' | '3:4' | '1:1' | '4:5'
    const [cropMode, setCropMode] = useState('full');
    const [cropOffset, setCropOffset] = useState(0);

    // 输出目录与截图图库
    const [outputDir, setOutputDir] = useState(() => {
        return localStorage.getItem('snap_output_dir') || '';
    });
    const [snapshots, setSnapshots] = useState([]);

    // 路径载入视频核心逻辑
    const loadVideoFromPath = useCallback((filePath) => {
        if (!filePath) return;
        const fileName = filePath.split(/[\\/]/).pop() || '本地视频';
        setVideoSource(toAssetUrl(filePath));
        setVideoMeta(prev => ({ ...prev, name: fileName, path: filePath }));
        setCropOffset(0);

        // 若尚未设置输出目录，默认设置为该视频所在的同级目录/快门截图
        if (!outputDir) {
            const parentDir = filePath.substring(0, Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/')));
            if (parentDir) {
                const defaultOut = `${parentDir}/快门截图`;
                setOutputDir(defaultOut);
                localStorage.setItem('snap_output_dir', defaultOut);
            }
        }
    }, [outputDir]);

    // 注册 Tauri 原生桌面文件拖拽监听（100% 稳定响应外部文件拖入）
    useEffect(() => {
        let unlisten = null;
        (async () => {
            unlisten = await setupNativeFileDrop((paths) => {
                if (paths && paths.length > 0) {
                    loadVideoFromPath(paths[0]);
                }
            });
        })();

        return () => {
            if (unlisten && typeof unlisten === 'function') {
                unlisten();
            }
        };
    }, [loadVideoFromPath]);

    // 选择保存目录
    const handleSelectOutputDir = async () => {
        try {
            const chosen = await selectFolder(outputDir);
            if (chosen) {
                setOutputDir(chosen);
                localStorage.setItem('snap_output_dir', chosen);
            }
        } catch (err) {
            console.error('选择目录失败:', err);
        }
    };

    // 按钮打开视频文件
    const handleOpenVideo = async () => {
        try {
            const filePath = await selectVideoFile();
            if (filePath) {
                loadVideoFromPath(filePath);
            }
        } catch (err) {
            console.error('选择文件失败:', err);
        }
    };

    // 拖拽文件进入舞台 (HTML5 drop 兜底)
    const handleFileLoaded = (file) => {
        if (!file) return;
        if (file.path) {
            loadVideoFromPath(file.path);
        } else {
            setVideoSource(file);
            setVideoMeta(prev => ({
                ...prev,
                name: file.name,
                path: '',
            }));
            setCropOffset(0);
        }
    };

    // 快门触发保存
    const handleShutterCapture = useCallback(async ({ base64, width, height, timeSec }) => {
        const filePrefix = videoMeta.name
            ? videoMeta.name.replace(/\.[^/.]+$/, "")
            : 'snap';

        const targetDir = outputDir || 'C:/Users/Public/Pictures/快门截图';

        try {
            const res = await saveSnapshot({
                outputDir: targetDir,
                filePrefix,
                format: 'jpg',
                base64Data: base64,
            });

            const newSnapshot = {
                id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                filePath: res.file_path,
                fileName: res.file_name,
                base64,
                width,
                height,
                timeSec,
                timestamp: res.timestamp,
            };

            setSnapshots(prev => [newSnapshot, ...prev]);
        } catch (err) {
            console.error('快门保存失败:', err);
        }
    }, [videoMeta.name, outputDir]);

    // 单张删除废片
    const handleDeleteSnapshot = useCallback(async (id, filePath) => {
        try {
            if (filePath) {
                await deleteSnapshot(filePath);
            }
            setSnapshots(prev => prev.filter(s => s.id !== id));
        } catch (err) {
            console.error('删除截图失败:', err);
        }
    }, []);

    // 批量删除废片
    const handleBatchDeleteSnapshots = useCallback(async (ids) => {
        const idSet = new Set(ids);
        const toDelete = snapshots.filter(s => idSet.has(s.id));
        for (const item of toDelete) {
            if (item.filePath) {
                try {
                    await deleteSnapshot(item.filePath);
                } catch (e) {
                    console.error('批量删除失败:', e);
                }
            }
        }
        setSnapshots(prev => prev.filter(s => !idSet.has(s.id)));
    }, [snapshots]);

    return (
        <div className="flex flex-col w-screen h-screen bg-[#09090b] text-zinc-100 overflow-hidden font-sans">
            {/* 顶栏：现代硬朗极简工业美学 */}
            <header className="h-12 px-3.5 bg-[#0d0e11] border-b border-white/[0.07] flex items-center justify-between shrink-0 select-none z-40">
                {/* 左侧：品牌与打开视频 */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-md bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center shadow-inner text-zinc-200">
                            <Camera className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-semibold tracking-wider text-zinc-100 uppercase font-mono">Snap 快门</span>
                    </div>

                    <div className="h-3.5 w-px bg-white/[0.08]" />

                    <button
                        onClick={handleOpenVideo}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 text-xs font-medium text-zinc-200 hover:text-white transition border border-white/[0.06] shadow-sm"
                    >
                        <Video className="w-3.5 h-3.5 text-zinc-400" />
                        <span>打开视频</span>
                    </button>

                    {/* 视频信息指示 */}
                    {videoMeta.name && (
                        <div className="flex items-center gap-2 px-2 py-0.5 rounded bg-zinc-900/90 border border-white/[0.06] text-xs text-zinc-300 max-w-sm truncate">
                            <span className="truncate max-w-[180px] font-medium text-zinc-200" title={videoMeta.name}>
                                {videoMeta.name}
                            </span>
                            {videoMeta.width > 0 && (
                                <span className="font-mono text-[11px] text-zinc-500 shrink-0 border-l border-zinc-800 pl-2">
                                    {videoMeta.width}×{videoMeta.height}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* 中间：截图构图比例选择器（Segmented Control） */}
                <div className="flex items-center bg-zinc-900/90 p-0.5 rounded-lg border border-white/[0.07] text-xs">
                    <button
                        onClick={() => setCropMode('full')}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition ${
                            cropMode === 'full'
                                ? 'bg-zinc-800 text-white font-medium shadow-sm border border-white/[0.08]'
                                : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                        title="全屏原图（100% 原始画幅完整抓取）"
                    >
                        <Maximize2 className="w-3 h-3" />
                        <span>原画全屏</span>
                    </button>

                    <button
                        onClick={() => setCropMode('free')}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition ${
                            cropMode === 'free'
                                ? 'bg-zinc-800 text-white font-medium shadow-sm border border-white/[0.08]'
                                : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                        title="自由比例（拖拽框边角任意缩放）"
                    >
                        <Crop className="w-3 h-3" />
                        <span>自由</span>
                    </button>

                    {['9:16', '3:4', '1:1', '4:5'].map(ratio => (
                        <button
                            key={ratio}
                            onClick={() => setCropMode(ratio)}
                            className={`px-2.5 py-1 rounded-md font-mono text-xs transition ${
                                cropMode === ratio
                                    ? 'bg-zinc-800 text-white font-medium shadow-sm border border-white/[0.08]'
                                    : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                            title={`固定比例：${ratio}`}
                        >
                            {ratio}
                        </button>
                    ))}
                </div>

                {/* 右侧：极简操作指引 */}
                <div className="flex items-center gap-3 text-xs text-zinc-400 font-mono">
                    <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                        <span className="flex items-center gap-1">
                            <kbd className="px-1 py-0.5 rounded bg-zinc-800/90 border border-zinc-700/60 text-zinc-300 text-[10px]">右键</kbd> 快门
                        </span>
                        <span className="text-zinc-600">·</span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1 py-0.5 rounded bg-zinc-800/90 border border-zinc-700/60 text-zinc-300 text-[10px]">侧键</kbd> 逐帧
                        </span>
                        <span className="text-zinc-600">·</span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1 py-0.5 rounded bg-zinc-800/90 border border-zinc-700/60 text-zinc-300 text-[10px]">Del</kbd> 删废片
                        </span>
                    </div>
                </div>
            </header>

            {/* 核心工作区：左侧取景舞台 + 右侧极速图库 */}
            <main className="flex-1 flex overflow-hidden">
                <section className="flex-1 relative h-full">
                    <VideoStage
                        videoSource={videoSource}
                        videoMeta={videoMeta}
                        onFileLoaded={handleFileLoaded}
                        cropMode={cropMode}
                        onCropModeChange={setCropMode}
                        cropOffset={cropOffset}
                        onCropOffsetChange={setCropOffset}
                        onShutterCapture={handleShutterCapture}
                        onVideoLoaded={(meta) => setVideoMeta(prev => ({ ...prev, ...meta }))}
                    />
                </section>

                <Gallery
                    snapshots={snapshots}
                    onDeleteSnapshot={handleDeleteSnapshot}
                    onBatchDeleteSnapshots={handleBatchDeleteSnapshots}
                    outputDir={outputDir}
                    onSelectOutputDir={handleSelectOutputDir}
                />
            </main>
        </div>
    );
}

export default App;
