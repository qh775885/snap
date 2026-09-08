import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Video, Play, Pause, RotateCcw, Crosshair, ChevronLeft, ChevronRight, Maximize2, Crop } from 'lucide-react';
import mpegts from 'mpegts.js';

export function VideoStage({
    videoSource,       // File 对象或本地路径字符串
    videoMeta,         // { name, path }
    onFileLoaded,      // 拖拽或选择新视频
    cropMode = 'full', // 'full' (全屏原画) | '9:16' | '3:4' | '1:1' | '4:5' | 'free' (自由框选)
    resolutionPreset = 'original', // 'original' | '1080p' | '720p'
    cropOffset = 0,    // -1 (最左) 到 1 (最右)
    onCropOffsetChange,
    onShutterCapture,  // 截图回调 ({ base64, width, height, timeSec })
    onTimeUpdate,
    onDurationChange,
    onVideoLoaded,
}) {
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const mpegtsPlayerRef = useRef(null);
    const progressBarRef = useRef(null);

    const [isDragOver, setIsDragOver] = useState(false);
    const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isShutterFlashing, setIsShutterFlashing] = useState(false);

    // 自由选框的局部坐标比例 [x, y, width, height] (0~1)
    const [freeCropRect, setFreeCropRect] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
    const [isAdjustingFreeCrop, setIsAdjustingFreeCrop] = useState(false);

    // 进度条拖拽中状态与悬浮提示
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [scrubHoverTime, setScrubHoverTime] = useState(null);
    const [scrubHoverPos, setScrubHoverPos] = useState(0);

    // 裁切框屏幕像素几何
    const [boxLayout, setBoxLayout] = useState({
        videoLeft: 0,
        videoTop: 0,
        videoWidth: 0,
        videoHeight: 0,
        boxWidth: 0,
        boxHeight: 0,
        boxX: 0,
        boxY: 0,
        maxOffsetX: 0,
    });

    // 裁切框缩放比例 (1.0 为贴满视频范围)
    const [boxScale, setBoxScale] = useState(1.0);

    // 计算当前比例系数 (宽 / 高)
    const getTargetAspectRatio = useCallback(() => {
        if (cropMode === 'full') {
            if (videoDimensions.width && videoDimensions.height) {
                return videoDimensions.width / videoDimensions.height;
            }
            return 16 / 9;
        }
        if (cropMode === 'free') {
            return freeCropRect.w / freeCropRect.h;
        }
        const [rw, rh] = cropMode.split(':').map(Number);
        return (rw && rh) ? (rw / rh) : (9 / 16);
    }, [cropMode, videoDimensions, freeCropRect]);

    // ===== 1. 视频加载与播放器挂载（TS 格式 mpegts.js / MP4 原生硬解） =====
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !videoSource) return;

        if (mpegtsPlayerRef.current) {
            mpegtsPlayerRef.current.destroy();
            mpegtsPlayerRef.current = null;
        }

        let isTsFormat = false;
        let videoUrl = '';

        if (typeof videoSource === 'string') {
            isTsFormat = videoSource.toLowerCase().endsWith('.ts') || videoSource.toLowerCase().endsWith('.m2ts');
            videoUrl = videoSource;
        } else if (videoSource instanceof File) {
            isTsFormat = videoSource.name.toLowerCase().endsWith('.ts') || videoSource.name.toLowerCase().endsWith('.m2ts');
            videoUrl = URL.createObjectURL(videoSource);
        }

        if (isTsFormat && mpegts.isSupported()) {
            const player = mpegts.createPlayer({
                type: 'mse',
                isLive: false,
                url: videoUrl,
            }, {
                enableWorker: true,
                lazyLoad: false,
                seekType: 'range',
            });
            player.attachMediaElement(video);
            player.load();
            mpegtsPlayerRef.current = player;
        } else {
            video.src = videoUrl;
            video.load();
        }

        return () => {
            if (mpegtsPlayerRef.current) {
                mpegtsPlayerRef.current.destroy();
                mpegtsPlayerRef.current = null;
            }
            if (typeof videoSource !== 'string' && videoUrl.startsWith('blob:')) {
                URL.revokeObjectURL(videoUrl);
            }
        };
    }, [videoSource]);

    // ===== 2. 视频元数据就绪与几何自适应 =====
    const handleLoadedMetadata = () => {
        const video = videoRef.current;
        if (!video) return;
        const vw = video.videoWidth || 1920;
        const vh = video.videoHeight || 1080;
        const dur = video.duration || 0;

        setVideoDimensions({ width: vw, height: vh });
        setDuration(dur);
        if (onDurationChange) onDurationChange(dur);
        if (onVideoLoaded) onVideoLoaded({ width: vw, height: vh, duration: dur });

        updateLayout(vw, vh);
    };

    // 重新计算屏幕上视频与裁切框的绝对位置
    const updateLayout = useCallback((vw = videoDimensions.width, vh = videoDimensions.height) => {
        const container = containerRef.current;
        if (!container || !vw || !vh) return;

        // 底部留出 56px 给控制栏与进度条空间
        const cWidth = container.clientWidth;
        const cHeight = Math.max(100, container.clientHeight - 60);
        if (!cWidth || !cHeight) return;

        const vRatio = vw / vh;
        const cRatio = cWidth / cHeight;

        let dWidth, dHeight;
        if (cRatio > vRatio) {
            dHeight = cHeight;
            dWidth = dHeight * vRatio;
        } else {
            dWidth = cWidth;
            dHeight = dWidth / vRatio;
        }

        const vLeft = (cWidth - dWidth) / 2;
        const vTop = (cHeight - dHeight) / 2;

        if (cropMode === 'full') {
            setBoxLayout({
                videoLeft: vLeft,
                videoTop: vTop,
                videoWidth: dWidth,
                videoHeight: dHeight,
                boxWidth: dWidth,
                boxHeight: dHeight,
                boxX: vLeft,
                boxY: vTop,
                maxOffsetX: 0,
            });
            return;
        }

        if (cropMode === 'free') {
            const bX = vLeft + freeCropRect.x * dWidth;
            const bY = vTop + freeCropRect.y * dHeight;
            const bW = freeCropRect.w * dWidth;
            const bH = freeCropRect.h * dHeight;
            setBoxLayout({
                videoLeft: vLeft,
                videoTop: vTop,
                videoWidth: dWidth,
                videoHeight: dHeight,
                boxWidth: bW,
                boxHeight: bH,
                boxX: bX,
                boxY: bY,
                maxOffsetX: dWidth - bW,
            });
            return;
        }

        // 固定比例模式 (9:16, 3:4, 1:1, 4:5)
        const aspect = getTargetAspectRatio();
        let bHeight = dHeight * boxScale;
        let bWidth = bHeight * aspect;

        if (bWidth > dWidth) {
            bWidth = dWidth;
            bHeight = bWidth / aspect;
        }

        const maxOffsetX = Math.max(0, (dWidth - bWidth) / 2);
        const currentOffsetX = cropOffset * maxOffsetX;
        const bX = vLeft + (dWidth - bWidth) / 2 + currentOffsetX;
        const bY = vTop + (dHeight - bHeight) / 2;

        setBoxLayout({
            videoLeft: vLeft,
            videoTop: vTop,
            videoWidth: dWidth,
            videoHeight: dHeight,
            boxWidth: bWidth,
            boxHeight: bHeight,
            boxX: bX,
            boxY: bY,
            maxOffsetX,
        });
    }, [videoDimensions, boxScale, cropOffset, cropMode, freeCropRect, getTargetAspectRatio]);

    // 监听容器大小变更
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver(() => updateLayout());
        observer.observe(container);
        updateLayout();

        return () => observer.disconnect();
    }, [updateLayout]);

    // ===== 3. 专业级高刷平滑步进引擎（侧键前后：单击单帧微调，长按平滑加速） =====
    const steppingRef = useRef({
        active: false,
        direction: 1, // 1: 前进, -1: 后退
        startTime: 0,
        rafId: null,
    });

    const stepEngine = useCallback(() => {
        const state = steppingRef.current;
        if (!state.active) return;

        const video = videoRef.current;
        if (!video) return;

        const now = performance.now();
        const elapsed = now - state.startTime;

        if (elapsed < 180) {
            state.rafId = requestAnimationFrame(stepEngine);
            return;
        }

        // 长按平滑递增提速
        let rate = 1.0;
        if (elapsed > 2000) {
            rate = 8.0 + Math.min(8.0, (elapsed - 2000) / 400); // 8x ~ 16x
        } else if (elapsed > 800) {
            rate = 2.0 + ((elapsed - 800) / 1200) * 4.0; // 2x ~ 6x
        } else {
            rate = 1.0;
        }

        if (!video.seeking) {
            const frameDelta = (1 / 30) * rate;
            const newTime = Math.max(0, Math.min(video.duration || 999999, video.currentTime + frameDelta * state.direction));
            video.currentTime = newTime;
        }

        state.rafId = requestAnimationFrame(stepEngine);
    }, []);

    const startStepping = useCallback((direction) => {
        const video = videoRef.current;
        if (!video) return;

        if (!video.paused) {
            video.pause();
            setIsPlaying(false);
        }

        const singleFrameDelta = 1 / 30;
        video.currentTime = Math.max(0, Math.min(video.duration || 999999, video.currentTime + singleFrameDelta * direction));

        const state = steppingRef.current;
        state.active = true;
        state.direction = direction;
        state.startTime = performance.now();

        if (state.rafId) cancelAnimationFrame(state.rafId);
        state.rafId = requestAnimationFrame(stepEngine);
    }, [stepEngine]);

    const stopStepping = useCallback(() => {
        const state = steppingRef.current;
        state.active = false;
        if (state.rafId) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }
    }, []);

    // 监听鼠标侧键（button 3 和 4）
    const handlePointerDown = (e) => {
        if (e.button === 3) {
            e.preventDefault();
            e.stopPropagation();
            startStepping(-1);
            return;
        }
        if (e.button === 4) {
            e.preventDefault();
            e.stopPropagation();
            startStepping(1);
            return;
        }
    };

    const handlePointerUp = (e) => {
        if (e.button === 3 || e.button === 4) {
            e.preventDefault();
            e.stopPropagation();
            stopStepping();
        }
    };

    // 全局快捷键支持
    useEffect(() => {
        const onGlobalMouseUp = (e) => {
            if (e.button === 3 || e.button === 4) {
                stopStepping();
            }
        };

        const onKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === 'ArrowLeft') {
                if (!e.repeat) startStepping(-1);
                e.preventDefault();
            } else if (e.key === 'ArrowRight') {
                if (!e.repeat) startStepping(1);
                e.preventDefault();
            } else if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
                togglePlay();
            } else if (e.key.toLowerCase() === 's') {
                e.preventDefault();
                triggerShutter();
            }
        };

        const onKeyUp = (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                stopStepping();
            }
        };

        window.addEventListener('pointerup', onGlobalMouseUp);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        return () => {
            window.removeEventListener('pointerup', onGlobalMouseUp);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            stopStepping();
        };
    }, [startStepping, stopStepping]);

    // ===== 4. 鼠标右键：毫秒级快门直裁与高清写盘 =====
    const triggerShutter = useCallback(() => {
        const video = videoRef.current;
        if (!video || !video.videoWidth || !video.videoHeight) return;

        // 80ms 白闪快门反馈
        setIsShutterFlashing(true);
        setTimeout(() => setIsShutterFlashing(false), 90);

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const dw = boxLayout.videoWidth;
        const dh = boxLayout.videoHeight;
        if (!dw || !dh) return;

        let sourceX = 0;
        let sourceY = 0;
        let sourceW = vw;
        let sourceH = vh;

        // 全屏模式下：直接一比一截取完整视频画面
        if (cropMode === 'full') {
            sourceX = 0;
            sourceY = 0;
            sourceW = vw;
            sourceH = vh;
        } else {
            // 裁剪模式下：精确映射屏幕框到原始物理像素
            const scaleX = vw / dw;
            const scaleY = vh / dh;

            const cropScreenX = boxLayout.boxX - boxLayout.videoLeft;
            const cropScreenY = boxLayout.boxY - boxLayout.videoTop;

            sourceX = Math.max(0, Math.round(cropScreenX * scaleX));
            sourceY = Math.max(0, Math.round(cropScreenY * scaleY));
            sourceW = Math.min(vw - sourceX, Math.round(boxLayout.boxWidth * scaleX));
            sourceH = Math.min(vh - sourceY, Math.round(boxLayout.boxHeight * scaleY));
        }

        // 根据 resolutionPreset 确定输出画布尺寸
        let outW = sourceW;
        let outH = sourceH;

        if (resolutionPreset === '1080p') {
            const ratio = sourceW / sourceH;
            if (ratio < 1) { // 竖图
                outH = 1920;
                outW = Math.round(outH * ratio);
            } else { // 横图
                outW = 1920;
                outH = Math.round(outW / ratio);
            }
        } else if (resolutionPreset === '720p') {
            const ratio = sourceW / sourceH;
            if (ratio < 1) {
                outH = 1280;
                outW = Math.round(outH * ratio);
            } else {
                outW = 1280;
                outH = Math.round(outW / ratio);
            }
        }

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = outW;
        offscreenCanvas.height = outH;
        const ctx = offscreenCanvas.getContext('2d', { alpha: false });

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
            video,
            sourceX, sourceY, sourceW, sourceH,
            0, 0, outW, outH
        );

        const base64 = offscreenCanvas.toDataURL('image/jpeg', 0.95);

        if (onShutterCapture) {
            onShutterCapture({
                base64,
                width: outW,
                height: outH,
                timeSec: video.currentTime,
            });
        }
    }, [boxLayout, cropMode, resolutionPreset, onShutterCapture]);

    const handleContextMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerShutter();
    };

    // ===== 5. 裁切框鼠标拖动与滚轮调整 =====
    const isDraggingCrop = useRef(false);
    const dragStartX = useRef(0);
    const startCropOffset = useRef(0);

    const handleCropMouseDown = (e) => {
        if (e.button !== 0 || cropMode === 'full') return;
        e.preventDefault();
        e.stopPropagation();

        isDraggingCrop.current = true;
        dragStartX.current = e.clientX;
        startCropOffset.current = cropOffset;

        const onMouseMove = (moveEvt) => {
            if (!isDraggingCrop.current) return;
            const deltaX = moveEvt.clientX - dragStartX.current;
            const maxOffset = boxLayout.maxOffsetX;
            if (maxOffset <= 0) return;

            const offsetRatioDelta = deltaX / maxOffset;
            const nextOffset = Math.max(-1, Math.min(1, startCropOffset.current + offsetRatioDelta));
            if (onCropOffsetChange) onCropOffsetChange(nextOffset);
        };

        const onMouseUp = () => {
            isDraggingCrop.current = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    const handleWheel = (e) => {
        if (cropMode === 'full') return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        setBoxScale(prev => Math.max(0.3, Math.min(1.0, prev + delta)));
    };

    // ===== 6. 交互式视频进度条点击与拖拽跳转 =====
    const handleProgressBarClickOrDrag = (e) => {
        const bar = progressBarRef.current;
        const video = videoRef.current;
        if (!bar || !video || !duration) return;

        const rect = bar.getBoundingClientRect();
        const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const percentage = clickX / rect.width;
        const targetTime = percentage * duration;

        video.currentTime = targetTime;
        setCurrentTime(targetTime);
    };

    const handleProgressBarMouseDown = (e) => {
        if (e.button !== 0) return;
        setIsScrubbing(true);
        handleProgressBarClickOrDrag(e);

        const onMouseMove = (moveEvt) => {
            handleProgressBarClickOrDrag(moveEvt);
        };

        const onMouseUp = () => {
            setIsScrubbing(false);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    const handleProgressBarMouseMove = (e) => {
        const bar = progressBarRef.current;
        if (!bar || !duration) return;
        const rect = bar.getBoundingClientRect();
        const hoverX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const hoverPercent = hoverX / rect.width;
        setScrubHoverTime(hoverPercent * duration);
        setScrubHoverPos(hoverX);
    };

    // 播放/暂停
    const togglePlay = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            video.play();
            setIsPlaying(true);
        } else {
            video.pause();
            setIsPlaying(false);
        }
    };

    // 文件拖拽加载（兼容 HTML5 drop）
    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragOver(true);
    };

    const handleDragLeave = () => {
        setIsDragOver(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragOver(false);
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (onFileLoaded) onFileLoaded(file);
        }
    };

    const formatSeconds = (sec) => {
        if (!sec || isNaN(sec)) return "00:00";
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    return (
        <div
            ref={containerRef}
            className={`relative w-full h-full bg-[#0a0c10] flex flex-col items-center justify-between select-none overflow-hidden ${
                isDragOver ? 'ring-2 ring-emerald-500 bg-[#0f141c]' : ''
            }`}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onContextMenu={handleContextMenu}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onWheel={handleWheel}
        >
            {/* 快门击发白闪遮罩 */}
            {isShutterFlashing && (
                <div className="absolute inset-0 bg-white/75 z-50 pointer-events-none transition-opacity duration-75" />
            )}

            {/* 隐藏的真实 video 元素 */}
            <video
                ref={videoRef}
                className="hidden"
                crossOrigin="anonymous"
                playsInline
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={() => {
                    const t = videoRef.current?.currentTime || 0;
                    setCurrentTime(t);
                    if (onTimeUpdate) onTimeUpdate(t);
                }}
                onEnded={() => setIsPlaying(false)}
            />

            {/* 当没有加载视频时显示拖放引导 */}
            {!videoSource && (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-4 pointer-events-none">
                    <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-2xl">
                        <Video className="w-14 h-14 text-slate-400 stroke-1" />
                    </div>
                    <div className="text-center">
                        <p className="text-base font-medium text-slate-200">直接将视频拖拽进窗口即可播放</p>
                        <p className="text-xs text-slate-400 mt-1">支持 MP4、TS、MKV、WebM、MOV 等全格式</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700">油管/推特/IG 视频</span>
                        <span className="px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700">TS 流媒体片段</span>
                        <span className="px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700">4K / 1080P 高清</span>
                    </div>
                </div>
            )}

            {/* 视频显示与构图裁切层 */}
            {videoSource && boxLayout.videoWidth > 0 && (
                <div className="flex-1 w-full relative overflow-hidden flex items-center justify-center">
                    <div
                        className="absolute"
                        style={{
                            left: `${boxLayout.videoLeft}px`,
                            top: `${boxLayout.videoTop}px`,
                            width: `${boxLayout.videoWidth}px`,
                            height: `${boxLayout.videoHeight}px`,
                        }}
                    >
                        {/* 视频真实画面 Canvas */}
                        <canvas
                            ref={(canvas) => {
                                if (!canvas || !videoRef.current) return;
                                canvas.width = boxLayout.videoWidth;
                                canvas.height = boxLayout.videoHeight;
                                const ctx = canvas.getContext('2d');
                                if (ctx && videoRef.current) {
                                    ctx.drawImage(videoRef.current, 0, 0, boxLayout.videoWidth, boxLayout.videoHeight);
                                }
                            }}
                            className="w-full h-full block"
                        />

                        {/* 如果是裁剪模式（9:16/3:4/1:1/4:5/free），显示半透明暗色遮罩与构图框 */}
                        {cropMode !== 'full' && (
                            <>
                                {/* 左遮罩 */}
                                <div
                                    className="absolute top-0 bottom-0 left-0 bg-black/70 backdrop-blur-[1px] pointer-events-none transition-all duration-75"
                                    style={{ width: `${Math.max(0, boxLayout.boxX - boxLayout.videoLeft)}px` }}
                                />
                                {/* 右遮罩 */}
                                <div
                                    className="absolute top-0 bottom-0 right-0 bg-black/70 backdrop-blur-[1px] pointer-events-none transition-all duration-75"
                                    style={{ width: `${Math.max(0, boxLayout.videoWidth - (boxLayout.boxX - boxLayout.videoLeft + boxLayout.boxWidth))}px` }}
                                />
                                {/* 上遮罩 */}
                                <div
                                    className="absolute left-0 right-0 top-0 bg-black/70 backdrop-blur-[1px] pointer-events-none"
                                    style={{
                                        height: `${Math.max(0, boxLayout.boxY - boxLayout.videoTop)}px`,
                                        left: `${boxLayout.boxX - boxLayout.videoLeft}px`,
                                        width: `${boxLayout.boxWidth}px`,
                                    }}
                                />
                                {/* 下遮罩 */}
                                <div
                                    className="absolute left-0 right-0 bottom-0 bg-black/70 backdrop-blur-[1px] pointer-events-none"
                                    style={{
                                        height: `${Math.max(0, boxLayout.videoHeight - (boxLayout.boxY - boxLayout.videoTop + boxLayout.boxHeight))}px`,
                                        left: `${boxLayout.boxX - boxLayout.videoLeft}px`,
                                        width: `${boxLayout.boxWidth}px`,
                                    }}
                                />

                                {/* 裁切框 */}
                                <div
                                    className="absolute cursor-grab active:cursor-grabbing border-2 border-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.35)] hover:border-emerald-300 transition-colors"
                                    style={{
                                        left: `${boxLayout.boxX - boxLayout.videoLeft}px`,
                                        top: `${boxLayout.boxY - boxLayout.videoTop}px`,
                                        width: `${boxLayout.boxWidth}px`,
                                        height: `${boxLayout.boxHeight}px`,
                                    }}
                                    onMouseDown={handleCropMouseDown}
                                >
                                    {/* 三等分辅助线 */}
                                    <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 opacity-25">
                                        <div className="border-r border-b border-white" />
                                        <div className="border-r border-b border-white" />
                                        <div className="border-b border-white" />
                                        <div className="border-r border-b border-white" />
                                        <div className="border-r border-b border-white" />
                                        <div className="border-b border-white" />
                                        <div className="border-r border-white" />
                                        <div className="border-r border-white" />
                                        <div />
                                    </div>

                                    {/* 准心 */}
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40">
                                        <Crosshair className="w-5 h-5 text-emerald-400" />
                                    </div>

                                    {/* 比例提示标 */}
                                    <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/80 border border-emerald-500/40 text-[11px] font-mono text-emerald-300 pointer-events-none backdrop-blur-sm">
                                        {cropMode}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* 专业级视频进度条与播放控制底栏 */}
            {videoSource && (
                <div className="w-full bg-[#11141c]/95 border-t border-slate-800 px-4 py-2.5 flex flex-col gap-2 z-30 shrink-0 select-none">
                    {/* 交互式进度条 */}
                    <div
                        ref={progressBarRef}
                        onMouseDown={handleProgressBarMouseDown}
                        onMouseMove={handleProgressBarMouseMove}
                        onMouseLeave={() => setScrubHoverTime(null)}
                        className="relative h-2 hover:h-3.5 bg-slate-800 rounded-full cursor-pointer transition-all flex items-center group"
                    >
                        {/* 播放进度填色 */}
                        <div
                            className="h-full bg-emerald-500 rounded-full relative"
                            style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                        >
                            {/* 进度滑块圆点 */}
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow border-2 border-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>

                        {/* 悬浮时间预览气泡 */}
                        {scrubHoverTime !== null && (
                            <div
                                className="absolute -top-7 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-slate-200 pointer-events-none -translate-x-1/2 shadow-lg"
                                style={{ left: `${scrubHoverPos}px` }}
                            >
                                {formatSeconds(scrubHoverTime)}
                            </div>
                        )}
                    </div>

                    {/* 控制按钮与时间指示 */}
                    <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                            {/* 播放/暂停按钮 */}
                            <button
                                onClick={togglePlay}
                                className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold transition shadow"
                                title="播放 / 暂停 (空格键)"
                            >
                                {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                            </button>

                            {/* 单帧后退/前进 */}
                            <button
                                onClick={() => startStepping(-1)}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                                title="单帧后退 (侧键后退 / 左方向键)"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => startStepping(1)}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                                title="单帧前进 (侧键前进 / 右方向键)"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>

                            {/* 时间戳与帧数 */}
                            <div className="flex items-center gap-1.5 font-mono text-slate-300 ml-2">
                                <span className="text-white font-semibold">{formatSeconds(currentTime)}</span>
                                <span className="text-slate-600">/</span>
                                <span className="text-slate-400">{formatSeconds(duration)}</span>
                            </div>
                        </div>

                        {/* 中部模式提示 */}
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                            {cropMode === 'full' ? (
                                <span className="flex items-center gap-1 text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                    <Maximize2 className="w-3.5 h-3.5" />
                                    <span>全屏原比例截取</span>
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                                    <Crop className="w-3.5 h-3.5" />
                                    <span>{cropMode} 构图裁切中</span>
                                </span>
                            )}
                        </div>

                        {/* 右侧快门击发与重置 */}
                        <div className="flex items-center gap-2">
                            {cropMode !== 'full' && (
                                <button
                                    onClick={() => {
                                        if (onCropOffsetChange) onCropOffsetChange(0);
                                        setBoxScale(1.0);
                                    }}
                                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                                    title="恢复居中"
                                >
                                    <RotateCcw className="w-3 h-3" />
                                    <span>居中</span>
                                </button>
                            )}

                            <button
                                onClick={triggerShutter}
                                className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold shadow-md transition active:scale-95"
                                title="截取当前画面 (鼠标右键)"
                            >
                                <span>快门 (右键)</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
