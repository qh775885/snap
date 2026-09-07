import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, FolderOpen, Image as ImageIcon, X, ChevronLeft, ChevronRight, Scissors } from 'lucide-react';
import { version } from '../../package.json';

export function Sidebar({ frames, onClear, onDeleteFrame, onRestoreFrame, onPortraitProcess, onDownload, cacheDir, onSelectCacheDir }) {
    const [previewIndex, setPreviewIndex] = useState(-1); // -1 means closed
    const [isAboutOpen, setIsAboutOpen] = useState(false);
    const [isPortraitWorkbenchOpen, setIsPortraitWorkbenchOpen] = useState(false);
    const [portraitRatio, setPortraitRatio] = useState('3:4');
    const [activeWorkbenchId, setActiveWorkbenchId] = useState(null);
    const [workbenchOffset, setWorkbenchOffset] = useState(0);
    const [previewMetrics, setPreviewMetrics] = useState({ width: 0, height: 0, maxOffset: 0 });
    const previewContainerRef = useRef(null);
    const previewImageRef = useRef(null);
    const workbenchThumbStripRef = useRef(null);
    const isDraggingCropRef = useRef(false);
    const dragStartXRef = useRef(0);
    const dragStartOffsetRef = useRef(0);

    // --- Lightbox Logic ---
    const handleNext = useCallback(() => {
        setPreviewIndex(prev => Math.min(prev + 1, frames.length - 1));
    }, [frames.length]);

    const handlePrev = useCallback(() => {
        setPreviewIndex(prev => Math.max(prev - 1, 0));
    }, [frames.length]);

    // Keyboard & Wheel Events for Lightbox
    useEffect(() => {
        if (previewIndex === -1) return;

        const handleKeyDown = (e) => {
            if (e.key === 'ArrowRight') handleNext();
            if (e.key === 'ArrowLeft') handlePrev();
            if (e.key === 'Escape') setPreviewIndex(-1);
        };

        const handleWheel = (e) => {
            if (e.deltaY > 0) handleNext();
            if (e.deltaY < 0) handlePrev();
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('wheel', handleWheel);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('wheel', handleWheel);
        };
    }, [previewIndex, handleNext, handlePrev]);

    const currentFrame = previewIndex >= 0 ? frames[previewIndex] : null;
    const horizontalFrames = useMemo(() => frames.filter(frame => !frame.isPortrait), [frames]);
    const portraitFrames = useMemo(() => frames.filter(frame => frame.isPortrait), [frames]);
    const feedbackFrames = useMemo(() => [...portraitFrames], [portraitFrames]);
    const frameNumberMap = useMemo(() => new Map(frames.map((frame, index) => [frame.id, index + 1])), [frames]);
    const hasHorizontalFrames = horizontalFrames.length > 0;
    const activeWorkbenchFrame = horizontalFrames.find(frame => frame.id === activeWorkbenchId) || horizontalFrames[0] || null;
    const activeWorkbenchIndex = activeWorkbenchFrame ? horizontalFrames.findIndex(frame => frame.id === activeWorkbenchFrame.id) : -1;
    const latestPortraitFeedback = feedbackFrames.find(frame => frame.isPortrait) || null;

    const updatePreviewMetrics = useCallback(() => {
        const container = previewContainerRef.current;
        const image = previewImageRef.current;
        if (!container || !image || !image.naturalWidth || !image.naturalHeight) return;

        const imageRatio = image.naturalWidth / image.naturalHeight;
        const containerRatio = container.clientWidth / container.clientHeight;
        let displayWidth = 0;
        let displayHeight = 0;

        if (containerRatio > imageRatio) {
            displayHeight = container.clientHeight;
            displayWidth = displayHeight * imageRatio;
        } else {
            displayWidth = container.clientWidth;
            displayHeight = displayWidth / imageRatio;
        }

        const [ratioW, ratioH] = portraitRatio.split(':').map(Number);
        const maskWidth = Math.min(displayWidth, displayHeight * (ratioW / ratioH));
        const maxOffset = Math.max(0, (displayWidth - maskWidth) / 2);

        setPreviewMetrics({ width: maskWidth, height: displayHeight, maxOffset });
    }, [portraitRatio]);

    useEffect(() => {
        if (!isPortraitWorkbenchOpen) return;
        if (!activeWorkbenchFrame && horizontalFrames[0]) {
            setActiveWorkbenchId(horizontalFrames[0].id);
        }
    }, [isPortraitWorkbenchOpen, activeWorkbenchFrame, horizontalFrames]);

    useEffect(() => {
        if (!isPortraitWorkbenchOpen || !activeWorkbenchFrame || !workbenchThumbStripRef.current) return;
        const activeThumb = workbenchThumbStripRef.current.querySelector(`[data-workbench-thumb-id="${activeWorkbenchFrame.id}"]`);
        if (activeThumb?.scrollIntoView) {
            activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }, [activeWorkbenchFrame, isPortraitWorkbenchOpen]);

    useEffect(() => {
        if (!isPortraitWorkbenchOpen) return;
        setWorkbenchOffset(0);
    }, [isPortraitWorkbenchOpen, activeWorkbenchId, portraitRatio]);

    useEffect(() => {
        if (!isPortraitWorkbenchOpen) return;
        updatePreviewMetrics();
        const observer = new ResizeObserver(updatePreviewMetrics);
        if (previewContainerRef.current) observer.observe(previewContainerRef.current);

        return () => observer.disconnect();
    }, [isPortraitWorkbenchOpen, activeWorkbenchId, updatePreviewMetrics]);

    useEffect(() => {
        if (!isPortraitWorkbenchOpen) return;

        const handleMouseMove = (e) => {
            if (!isDraggingCropRef.current || previewMetrics.maxOffset <= 0) return;
            const deltaRatio = (e.clientX - dragStartXRef.current) / previewMetrics.maxOffset;
            const nextOffset = Math.max(-1, Math.min(1, dragStartOffsetRef.current + deltaRatio));
            setWorkbenchOffset(nextOffset);
        };

        const handleMouseUp = () => {
            isDraggingCropRef.current = false;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isPortraitWorkbenchOpen, previewMetrics.maxOffset]);

    const openPortraitWorkbench = () => {
        if (!horizontalFrames[0]) return;
        setActiveWorkbenchId(horizontalFrames[0].id);
        setWorkbenchOffset(0);
        setIsPortraitWorkbenchOpen(true);
    };

    const handleWorkbenchCrop = useCallback((frameIds) => {
        if (!frameIds || frameIds.length === 0) return;
        onPortraitProcess({ frameIds, ratio: portraitRatio, offset: workbenchOffset });
    }, [onPortraitProcess, portraitRatio, workbenchOffset]);

    const handleWorkbenchStep = useCallback((direction) => {
        if (!horizontalFrames.length || activeWorkbenchIndex === -1) return;
        const nextIndex = Math.max(0, Math.min(horizontalFrames.length - 1, activeWorkbenchIndex + direction));
        setActiveWorkbenchId(horizontalFrames[nextIndex].id);
    }, [activeWorkbenchIndex, horizontalFrames]);

    const scrollWorkbenchThumbs = useCallback((direction) => {
        const strip = workbenchThumbStripRef.current;
        if (!strip) return;
        strip.scrollBy({ left: direction * 320, behavior: 'smooth' });
    }, []);

    const handleCropMouseDown = (e) => {
        if (previewMetrics.maxOffset <= 0) return;
        e.preventDefault();
        e.stopPropagation();
        isDraggingCropRef.current = true;
        dragStartXRef.current = e.clientX;
        dragStartOffsetRef.current = workbenchOffset;
    };

    const handleWorkbenchRightClick = (e) => {
        if (!activeWorkbenchFrame) return;
        e.preventDefault();
        e.stopPropagation();
        handleWorkbenchCrop([activeWorkbenchFrame.id]);
    };

    const handleFeedbackPreview = useCallback((frame) => {
        const frameIndex = frames.findIndex(item => item.id === frame.id);
        if (frameIndex !== -1) {
            setPreviewIndex(frameIndex);
        }
        if (!frame.isPortrait && horizontalFrames.some(item => item.id === frame.id)) {
            setActiveWorkbenchId(frame.id);
        }
    }, [frames, horizontalFrames]);


    useEffect(() => {
        if (!isPortraitWorkbenchOpen) return;

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setIsPortraitWorkbenchOpen(false);
                return;
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                handleWorkbenchStep(-1);
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                handleWorkbenchStep(1);
                return;
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (activeWorkbenchFrame) {
                    handleWorkbenchCrop([activeWorkbenchFrame.id]);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeWorkbenchFrame, handleWorkbenchCrop, handleWorkbenchStep, isPortraitWorkbenchOpen]);

    return (
        <div className="flex flex-col h-full bg-zinc-950/90 backdrop-blur-xl border-l border-white/10 w-[320px]">
            {/* Settings Segment */}
            <div className="p-5 flex flex-col gap-4 border-b border-white/5 shrink-0">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">存储设置</h3>
                <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/50 border border-white/5 group hover:border-indigo-500/30 transition-colors">
                    <div className="flex flex-col min-w-0">
                        <span className="text-[10px] text-zinc-500 font-bold mb-0.5">保存位置</span>
                        <span className="text-xs text-zinc-300 truncate" title={cacheDir || "未设置"}>
                            {cacheDir || "未设置 (仅内存预览)"}
                        </span>
                    </div>
                    <button
                        onClick={onSelectCacheDir}
                        className={`p-2 rounded-lg transition-all ${cacheDir ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white'}`}
                        title="更改保存目录"
                    >
                        <FolderOpen size={14} />
                    </button>
                </div>
            </div>

            {/* Gallery Segment */}
            <div className="flex-1 flex flex-col p-5 overflow-hidden min-h-0">
                <div className="flex items-center justify-between mb-4 shrink-0">
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">图库</h3>
                    <div className="flex items-center gap-2">
                        {hasHorizontalFrames && (
                            <button
                                onClick={openPortraitWorkbench}
                                className="flex items-center gap-1 text-[10px] text-purple-300 hover:text-white transition-colors px-2 py-1 rounded bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20"
                            >
                                <Scissors size={12} />
                                横转竖
                            </button>
                        )}
                        <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">
                            {frames.length}
                        </span>
                        {frames.length > 0 && (
                            <div className="relative group">
                                <button
                                    className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-500/10"
                                >
                                    <Trash2 size={12} />
                                    清空
                                </button>
                                <div className="absolute right-0 top-full mt-1 w-[140px] py-1 bg-zinc-900 border border-white/10 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                                    <button
                                        onClick={() => onClear(false)}
                                        className="w-full text-left px-3 py-1.5 text-[10px] text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                                    >
                                        仅清空图库
                                    </button>
                                    <button
                                        onClick={() => onClear(true)}
                                        className="w-full text-left px-3 py-1.5 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                                    >
                                        清空并删除文件
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Scrollable Grid (2 Columns) */}
                <div className="flex-1 overflow-y-auto pr-2 -mr-2 no-scrollbar pb-20">
                    {frames.length === 0 ? (
                        <div className="h-40 flex flex-col items-center justify-center border-2 border-dashed border-zinc-800 rounded-xl text-zinc-600 gap-2 mt-4">
                            <ImageIcon size={24} className="opacity-50" />
                            <span className="text-xs">暂无截图</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2 items-start">
                            {frames.map((frame, index) => (
                                <div
                                    key={frame.id}
                                    className="group relative bg-zinc-900/50 rounded-lg border border-white/5 overflow-hidden hover:border-indigo-500/50 transition-all flex items-center justify-center cursor-zoom-in"
                                    style={{ aspectRatio: frame.ratio ? frame.ratio.replace(':', '/') : (frame.isPortrait ? '9/16' : '16/9') }}
                                    onClick={() => setPreviewIndex(index)}
                                >
                                    {/* Thumbnail: Contain to show full image within the square/video aspect */}
                                    <img
                                        src={frame.url}
                                        className="w-full h-full object-contain bg-black/40"
                                        alt={`Frame ${index}`}
                                    />

                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteFrame(frame.id);
                                        }}
                                        className="absolute top-1 right-1 p-1 rounded-md bg-black/55 text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-300 hover:bg-red-500/20 transition-all"
                                        title="删除这张"
                                    >
                                        <Trash2 size={11} />
                                    </button>

                                    {/* Overlay Info */}
                                    <div className="absolute top-1 left-1 px-1 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[8px] font-mono font-bold text-white border border-white/10 opacity-80 group-hover:opacity-100 transition-opacity">
                                        #{frameNumberMap.get(frame.id)}
                                    </div>
                                    <div className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[8px] font-mono font-bold text-white border border-white/10 opacity-60 group-hover:opacity-100 transition-opacity">
                                        {new Date(frame.time * 1000).toISOString().substr(14, 5)}
                                    </div>
                                    {frame.isPortrait && (
                                        <div className="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-indigo-500/80 text-[8px] font-bold text-white shadow-md">
                                            {frame.ratio || "9:16"}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Actions */}
            <div className="p-5 border-t border-white/5 bg-zinc-950/50 shrink-0 flex flex-col gap-3">
                <button
                    onClick={onDownload}
                    disabled={frames.length === 0}
                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border font-bold text-xs transition-all active:scale-95 ${frames.length > 0
                        ? 'bg-zinc-800 hover:bg-zinc-700 border-white/10 text-white hover:border-white/20'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed'
                        }`}
                >
                    <FolderOpen size={16} />
                    <span>打开保存文件夹</span>
                </button>

                <div className="flex items-center justify-between text-[10px] text-zinc-600 font-mono mt-1">
                    <button onClick={() => setIsAboutOpen(true)} className="hover:text-zinc-400 transition-colors cursor-pointer">关于本软件</button>
                    <span>v{version}</span>
                </div>
            </div>

            {/* About Modal */}
            {isAboutOpen && createPortal(
                <div
                    autoFocus
                    tabIndex={0}
                    className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200 select-none outline-none"
                    onClick={() => setIsAboutOpen(false)}
                >
                    <div className="w-[400px] bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl p-6 flex flex-col gap-4 relative" onClick={e => e.stopPropagation()}>
                        <button
                            className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors"
                            onClick={() => setIsAboutOpen(false)}
                        >
                            <X size={18} />
                        </button>

                        <div className="flex flex-col items-center gap-2 mb-2">
                            <div className="w-16 h-16 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-2xl shadow-lg flex items-center justify-center mb-2">
                                <ImageIcon size={32} className="text-white drop-shadow-md" />
                            </div>
                            <h2 className="text-xl font-bold text-white tracking-widest">视频截图神器</h2>
                            <span className="text-xs font-mono text-zinc-400">v{version}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-[11px] leading-relaxed">
                            <div className="flex flex-col gap-1.5 bg-white/5 p-3 rounded-xl border border-white/5">
                                <span className="text-zinc-500 font-bold uppercase tracking-wider text-[9px]">操作快捷键</span>
                                <div className="text-zinc-300 space-y-1">
                                    <p><span className="text-indigo-400 font-mono">空格</span> 播放/暂停</p>
                                    <p><span className="text-indigo-400 font-mono">S</span> 单张截图</p>
                                    <p><span className="text-indigo-400 font-mono">I / O</span> 设置区间始末</p>
                                    <p><span className="text-indigo-400 font-mono">← / →</span> 逐帧步进 (长按匀速)</p>
                                </div>
                            </div>
                            <div className="flex flex-col gap-1.5 bg-white/5 p-3 rounded-xl border border-white/5">
                                <span className="text-zinc-500 font-bold uppercase tracking-wider text-[9px]">使用提示</span>
                                <div className="text-zinc-300 space-y-1">
                                    <p>• 推荐张数下限为 <span className="text-indigo-400 font-mono">10</span> 张</p>
                                    <p>• 预览图双击可全屏沉浸浏览</p>
                                    <p>• 预览时 <span className="text-indigo-400 font-mono">←/→</span> 切换，<span className="text-indigo-400 font-mono">Esc</span> 退出</p>
                                </div>
                            </div>
                        </div>

                        <div className="h-px w-full bg-white/10 my-1"></div>

                        <div className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-zinc-500">项目主页</span>
                            <a
                                href="#"
                                onClick={(e) => { e.preventDefault(); window.require('electron').shell.openExternal('https://qh775885.github.io/snap/'); }}
                                className="text-indigo-400 hover:text-indigo-300 hover:underline text-[11px] font-mono transition-colors"
                            >
                                https://qh775885.github.io/snap/
                            </a>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {isPortraitWorkbenchOpen && activeWorkbenchFrame && createPortal(
                <div
                    className="fixed inset-0 z-[180] bg-black/80 backdrop-blur-sm flex items-center justify-center overflow-auto p-3 animate-in fade-in duration-200"
                    onClick={() => setIsPortraitWorkbenchOpen(false)}
                >
                    <div className="w-[1260px] max-w-[96vw] h-[92vh] max-h-[860px] bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl p-4 flex flex-col gap-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-bold text-white tracking-wide">横转竖操作台</h3>
                            </div>
                            <button
                                className="text-zinc-500 hover:text-white transition-colors"
                                onClick={() => setIsPortraitWorkbenchOpen(false)}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-black/30 border border-white/5 p-3">
                            <div className="flex items-center gap-2">
                                {['9:16', '3:4', '4:5'].map(ratio => (
                                    <button
                                        key={ratio}
                                        onClick={() => setPortraitRatio(ratio)}
                                        className={`h-9 px-4 rounded-xl text-xs font-bold font-mono transition-all ${portraitRatio === ratio
                                            ? 'bg-purple-500/30 text-purple-300 ring-1 ring-purple-500/50'
                                            : 'bg-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
                                            }`}
                                    >
                                        {ratio}
                                    </button>
                                ))}
                            </div>
                            <div className="hidden md:flex items-center gap-4 text-[11px] text-zinc-500">
                                <span>滚轮/左右切图</span>
                                <span>Enter 裁切</span>
                            </div>
                        </div>

                        <div className="min-h-0 flex-1">
                            <div className="grid h-full min-h-0 gap-3 grid-cols-[minmax(0,1fr)_280px] grid-rows-[minmax(0,1fr)_124px]">
                                <div className="rounded-2xl bg-black/40 border border-white/5 p-3 flex min-h-0 flex-col gap-3 lg:row-start-1">
                                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                                        <div className="flex items-center gap-3">
                                            <span>手动预览</span>
                                            <span className="px-2 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-200 font-mono">
                                                图库 #{frameNumberMap.get(activeWorkbenchFrame.id)} / {frames.length}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="hidden sm:block">右键直裁</span>
                                            <button
                                                onClick={() => handleWorkbenchCrop([activeWorkbenchFrame.id])}
                                                className="inline-flex items-center gap-1 rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1.5 text-[11px] font-medium text-purple-200 transition-colors hover:bg-purple-500/20 hover:text-white"
                                            >
                                                <Scissors size={12} />
                                                裁切当前图
                                            </button>
                                        </div>
                                    </div>

                                    <div
                                        ref={previewContainerRef}
                                        className="relative flex-1 min-h-0 rounded-2xl bg-black overflow-hidden border border-white/5"
                                        onContextMenu={handleWorkbenchRightClick}
                                        onWheel={(e) => {
                                            if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
                                            e.preventDefault();
                                            handleWorkbenchStep(e.deltaY > 0 ? 1 : -1);
                                        }}
                                    >
                                        <img
                                            ref={previewImageRef}
                                            src={activeWorkbenchFrame.url}
                                            alt="portrait-workbench"
                                            className="absolute inset-0 w-full h-full object-contain"
                                            onLoad={updatePreviewMetrics}
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <div
                                                className="rounded-md border-2 border-purple-400/90 bg-white/[0.02] shadow-[0_0_0_9999px_rgba(0,0,0,0.7)] pointer-events-auto cursor-grab active:cursor-grabbing"
                                                style={{
                                                    width: `${previewMetrics.width}px`,
                                                    height: `${previewMetrics.height}px`,
                                                    transform: `translateX(${workbenchOffset * previewMetrics.maxOffset}px)`
                                                }}
                                                onMouseDown={handleCropMouseDown}
                                            >
                                                <div className="absolute inset-0 opacity-20 pointer-events-none">
                                                    <div className="absolute top-1/3 left-0 w-full h-px bg-white"></div>
                                                    <div className="absolute top-2/3 left-0 w-full h-px bg-white"></div>
                                                    <div className="absolute left-1/3 top-0 h-full w-px bg-white"></div>
                                                    <div className="absolute left-2/3 top-0 h-full w-px bg-white"></div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="absolute left-3 top-3 px-2 py-1 rounded bg-black/60 border border-white/10 text-[10px] font-mono text-purple-200">
                                            {portraitRatio} | 偏移 {workbenchOffset.toFixed(2)}
                                        </div>
                                        <div className="absolute right-3 bottom-3 px-2 py-1 rounded bg-black/60 border border-white/10 text-[10px] font-mono text-zinc-200">
                                            {activeWorkbenchFrame ? new Date(activeWorkbenchFrame.time * 1000).toISOString().substr(11, 8) : '--:--:--'}
                                        </div>
                                        <button
                                            onClick={() => handleWorkbenchStep(-1)}
                                            disabled={activeWorkbenchIndex <= 0}
                                            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-black/55 p-2 text-zinc-300 transition-colors hover:bg-black/75 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                                        >
                                            <ChevronLeft size={18} />
                                        </button>
                                        <button
                                            onClick={() => handleWorkbenchStep(1)}
                                            disabled={activeWorkbenchIndex >= horizontalFrames.length - 1}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-black/55 p-2 text-zinc-300 transition-colors hover:bg-black/75 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                                        >
                                            <ChevronRight size={18} />
                                        </button>
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-white/5 bg-black/30 p-3 flex min-h-0 flex-col gap-2 col-start-1 row-start-2 overflow-hidden">
                                    <div className="flex items-center justify-between text-[11px] text-zinc-500 px-1">
                                        <span>原图</span>
                                        <div className="flex items-center gap-2">
                                            <span>{horizontalFrames.length} 张</span>
                                            <button
                                                onClick={() => scrollWorkbenchThumbs(-1)}
                                                className="rounded-lg border border-white/10 bg-white/5 p-1 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                                                title="向左滚动"
                                            >
                                                <ChevronLeft size={14} />
                                            </button>
                                            <button
                                                onClick={() => scrollWorkbenchThumbs(1)}
                                                className="rounded-lg border border-white/10 bg-white/5 p-1 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                                                title="向右滚动"
                                            >
                                                <ChevronRight size={14} />
                                            </button>
                                        </div>
                                    </div>

                                    <div
                                        ref={workbenchThumbStripRef}
                                        className="overflow-x-auto pb-1 -mb-1 no-scrollbar"
                                        onWheel={(e) => {
                                            if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
                                            e.preventDefault();
                                            e.currentTarget.scrollLeft += e.deltaY;
                                        }}
                                    >
                                        <div className="flex gap-2 min-w-max pr-2">
                                            {horizontalFrames.map((frame) => (
                                                <button
                                                    key={frame.id}
                                                    data-workbench-thumb-id={frame.id}
                                                    onClick={() => setActiveWorkbenchId(frame.id)}
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        setActiveWorkbenchId(frame.id);
                                                        handleWorkbenchCrop([frame.id]);
                                                    }}
                                                    className={`relative h-[72px] w-[128px] shrink-0 overflow-hidden rounded-xl border transition-all ${activeWorkbenchFrame.id === frame.id ? 'border-purple-400 bg-purple-500/10 shadow-[0_0_18px_rgba(168,85,247,0.16)]' : 'border-white/8 bg-black/45 hover:border-white/20'}`}
                                                >
                                                    <img src={frame.url} alt="workbench-thumb" className="w-full h-full object-cover bg-black/60" />
                                                    <div className="absolute left-2 top-2 px-2 py-1 rounded-lg bg-black/80 text-[10px] font-mono font-bold text-white border border-white/10 shadow-lg">
                                                        #{frameNumberMap.get(frame.id)}
                                                    </div>
                                                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1 text-[9px] font-mono backdrop-blur-sm bg-black/55 text-zinc-100">
                                                        <span>{new Date(frame.time * 1000).toISOString().substr(11, 8)}</span>
                                                        <span>原图</span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-white/5 bg-black/30 p-3 flex min-h-0 flex-col gap-2 col-start-2 row-span-2 min-w-[280px] overflow-hidden">
                                    <div className="flex items-center justify-between text-[11px] text-zinc-500 px-1 font-mono">
                                        <span>成品</span>
                                        <span>{portraitFrames.length}/{horizontalFrames.length}</span>
                                    </div>

                                    <div className="flex-1 overflow-y-auto pr-1 -mr-1 no-scrollbar grid grid-cols-2 gap-2 content-start auto-rows-max">
                                        {feedbackFrames.length === 0 ? (
                                            <div className="col-span-2 flex min-h-[220px] rounded-2xl border border-dashed border-white/10 items-center justify-center text-[12px] text-zinc-600">
                                                暂无成品
                                            </div>
                                        ) : (
                                            feedbackFrames.map((frame) => (
                                                <button
                                                    key={frame.id}
                                                    onClick={() => handleFeedbackPreview(frame)}
                                                    onContextMenu={(e) => {
                                                        if (!frame.sourceFrame) return;
                                                        e.preventDefault();
                                                        onRestoreFrame(frame.id);
                                                    }}
                                                    className={`relative overflow-hidden rounded-xl border bg-black/45 transition-all ${frame.id === latestPortraitFeedback?.id ? 'border-purple-500/70 shadow-[0_0_0_1px_rgba(168,85,247,0.35),0_0_10px_rgba(168,85,247,0.1)]' : 'border-white/8 hover:border-purple-400/40'}`}
                                                    title="点击看大图，右键复原"
                                                >
                                                    <div className="relative aspect-[3/4] overflow-hidden bg-black/60">
                                                        <img src={frame.url} alt="feedback-thumb" className="w-full h-full object-cover" />
                                                        <div className="absolute left-2 top-2 px-2 py-1 rounded-lg bg-black/82 text-[10px] font-mono font-bold text-white border border-white/10 shadow-lg">
                                                            #{frameNumberMap.get(frame.id)}
                                                        </div>
                                                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1.5 text-[9px] font-mono bg-black/60 text-zinc-100">
                                                            <span>{new Date(frame.time * 1000).toISOString().substr(11, 8)}</span>
                                                            <span>{frame.ratio || portraitRatio}</span>
                                                        </div>
                                                    </div>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Lightbox Modal (Full Screen with Nav) - Usage of Portal to break out of Sidebar container */}
            {previewIndex !== -1 && currentFrame && createPortal(
                <div
                    autoFocus
                    tabIndex={0}
                    className="fixed inset-0 z-[220] bg-black/95 backdrop-blur-xl flex items-center justify-center animate-in fade-in duration-200 select-none outline-none"
                    onClick={() => {
                        setPreviewIndex(-1);
                        // Force window body to regain active focus after portal unmount in Electron
                        setTimeout(() => document.body.focus(), 10);
                    }}
                >
                    {/* Main Image */}
                    <div className="relative w-full h-full flex items-center justify-center p-8" onClick={e => e.stopPropagation()}>
                        <img
                            src={currentFrame.url}
                            className="max-w-full max-h-full object-contain shadow-2xl drop-shadow-[0_0_50px_rgba(0,0,0,0.5)]"
                            alt="Preview"
                        />

                        {/* Info Badge */}
                        <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 px-4 py-2 backdrop-blur rounded-full border flex items-center gap-3 shadow-xl transition-all duration-300 ${previewIndex === frames.length - 1 ? 'bg-amber-900/80 border-amber-500/30' : previewIndex === 0 ? 'bg-indigo-900/60 border-indigo-500/30' : 'bg-zinc-900/80 border-white/10'}`}>
                            <span className={`text-xs font-mono font-bold ${previewIndex === frames.length - 1 ? 'text-amber-300' : 'text-indigo-300'}`}>#{frameNumberMap.get(currentFrame.id)} / {frames.length}</span>
                            {previewIndex === frames.length - 1 && <span className="text-xs font-bold text-amber-400">已是最后一张</span>}
                            {previewIndex === 0 && frames.length > 1 && <span className="text-xs font-bold text-indigo-300">第一张</span>}
                            <div className="w-px h-3 bg-white/20"></div>
                            <span className="text-xs font-mono text-zinc-300">{new Date(currentFrame.time * 1000).toISOString().substr(11, 8)}</span>
                        </div>

                        {/* Navigation Buttons */}
                        <button
                            className="absolute left-4 top-1/2 -translate-y-1/2 p-4 rounded-full bg-white/5 hover:bg-white/20 text-white/50 hover:text-white transition-all hover:scale-110 active:scale-95 group"
                            onClick={(e) => { e.stopPropagation(); handlePrev(); }}
                        >
                            <ChevronLeft size={32} className="group-hover:-translate-x-1 transition-transform" />
                        </button>

                        <button
                            className="absolute right-4 top-1/2 -translate-y-1/2 p-4 rounded-full bg-white/5 hover:bg-white/20 text-white/50 hover:text-white transition-all hover:scale-110 active:scale-95 group"
                            onClick={(e) => { e.stopPropagation(); handleNext(); }}
                        >
                            <ChevronRight size={32} className="group-hover:translate-x-1 transition-transform" />
                        </button>

                        {/* Close Button */}
                        <button
                            className="absolute top-6 right-6 p-3 rounded-full bg-white/10 hover:bg-red-500 text-white hover:rotate-90 transition-all duration-300 shadow-lg"
                            onClick={() => setPreviewIndex(-1)}
                        >
                            <X size={24} />
                        </button>

                        <button
                            className="absolute top-6 right-24 p-3 rounded-full bg-white/10 hover:bg-red-500/90 text-white transition-all duration-300 shadow-lg"
                            onClick={() => {
                                onDeleteFrame(currentFrame.id);
                                setPreviewIndex(-1);
                            }}
                            title="删除这张"
                        >
                            <Trash2 size={20} />
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
