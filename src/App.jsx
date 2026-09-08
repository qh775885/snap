import React, { useState, useEffect, useCallback } from 'react';
import { Camera, FolderOpen, Video, Crop, Layers, HelpCircle } from 'lucide-react';
import { VideoStage } from './components/VideoStage';
import { Gallery } from './components/Gallery';
import { selectFolder, selectVideoFile, saveSnapshot, deleteSnapshot, toAssetUrl } from './bridge';

export function App() {
    // 当前视频源
    const [videoSource, setVideoSource] = useState(null);
    const [videoMeta, setVideoMeta] = useState({ name: '', width: 0, height: 0, duration: 0 });

    // 构图比例与输出分辨率
    const [portraitRatio, setPortraitRatio] = useState('9:16');
    const [resolutionPreset, setResolutionPreset] = useState('original');
    const [cropOffset, setCropOffset] = useState(0);

    // 输出目录与截图图库
    const [outputDir, setOutputDir] = useState(() => {
        return localStorage.getItem('snap_output_dir') || '';
    });
    const [snapshots, setSnapshots] = useState([]);

    // 默认输出目录初始化（若本地未配置，提示选择或保存在当前用户目录）
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

    // 选择打开视频文件
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

    const loadVideoFromPath = (filePath) => {
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
    };

    // 拖拽文件进入舞台
    const handleFileLoaded = (file) => {
        if (!file) return;
        setVideoSource(file);
        setVideoMeta(prev => ({
            ...prev,
            name: file.name,
            path: file.path || '',
        }));
        setCropOffset(0);
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
        <div className="flex flex-col w-screen h-screen bg-[#0d1017] text-slate-100 overflow-hidden font-sans">
            {/* 极简清爽顶栏 */}
            <header className="h-14 px-4 bg-[#141820] border-b border-slate-800 flex items-center justify-between shrink-0 select-none z-40">
                {/* 品牌与主要打开视频按钮 */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shadow-inner">
                            <Camera className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-bold tracking-wide text-white">快门</span>
                            <span className="text-[10px] text-slate-400 font-mono -mt-0.5">snap lite</span>
                        </div>
                    </div>

                    <div className="h-4 w-px bg-slate-800 mx-1" />

                    <button
                        onClick={handleOpenVideo}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 hover:text-white transition shadow-sm border border-slate-700"
                    >
                        <Video className="w-3.5 h-3.5 text-emerald-400" />
                        <span>打开视频</span>
                    </button>

                    {/* 视频信息指示 */}
                    {videoMeta.name && (
                        <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-900/80 border border-slate-800 text-xs text-slate-300 max-w-sm truncate">
                            <span className="truncate max-w-[180px] font-medium" title={videoMeta.name}>
                                {videoMeta.name}
                            </span>
                            {videoMeta.width > 0 && (
                                <span className="font-mono text-[11px] text-slate-400 shrink-0">
                                    {videoMeta.width}×{videoMeta.height}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* 构图与分辨率选择器 */}
                <div className="flex items-center gap-4 text-xs">
                    {/* 构图比例 */}
                    <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-lg border border-slate-800">
                        <span className="px-2 text-slate-400 font-medium text-[11px]">构图</span>
                        {['9:16', '3:4', '1:1', '4:5'].map(ratio => (
                            <button
                                key={ratio}
                                onClick={() => setPortraitRatio(ratio)}
                                className={`px-2 py-1 rounded-md font-mono font-medium transition ${
                                    portraitRatio === ratio
                                        ? 'bg-emerald-500 text-slate-950 shadow'
                                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                                }`}
                            >
                                {ratio}
                            </button>
                        ))}
                    </div>

                    {/* 竖图输出分辨率 */}
                    <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-lg border border-slate-800">
                        <span className="px-2 text-slate-400 font-medium text-[11px]">尺寸</span>
                        {[
                            { id: 'original', label: '原画物理' },
                            { id: '1080p', label: '1080P' },
                            { id: '720p', label: '720P' },
                        ].map(preset => (
                            <button
                                key={preset.id}
                                onClick={() => setResolutionPreset(preset.id)}
                                className={`px-2 py-1 rounded-md font-medium transition ${
                                    resolutionPreset === preset.id
                                        ? 'bg-emerald-500 text-slate-950 shadow'
                                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                                }`}
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 快捷手感提示徽标 */}
                <div className="flex items-center gap-2 text-[11px] text-slate-400 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800/80">
                    <span className="text-emerald-400 font-medium">侧键前后: 连续平滑步进</span>
                    <span className="text-slate-700">|</span>
                    <span className="text-emerald-400 font-medium">右键: 瞬间截图</span>
                    <span className="text-slate-700">|</span>
                    <span className="text-rose-400 font-medium">Del: 秒删废片</span>
                </div>
            </header>

            {/* 核心工作区：左侧取景舞台 + 右侧极速图库 */}
            <main className="flex-1 flex overflow-hidden">
                <section className="flex-1 relative h-full">
                    <VideoStage
                        videoSource={videoSource}
                        videoMeta={videoMeta}
                        onFileLoaded={handleFileLoaded}
                        portraitRatio={portraitRatio}
                        resolutionPreset={resolutionPreset}
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
