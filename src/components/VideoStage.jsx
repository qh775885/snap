import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Video, Maximize2, RotateCcw, Crosshair } from 'lucide-react';
import mpegts from 'mpegts.js';

export function VideoStage({
    videoSource,       // File 对象或本地路径字符串
    videoMeta,         // { name, path }
    onFileLoaded,      // 拖拽或选择新视频
    portraitRatio = '9:16', // '9:16' | '3:4' | '1:1' | '4:5'
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

    const [isDragOver, setIsDragOver] = useState(false);
    const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isShutterFlashing, setIsShutterFlashing] = useState(false);

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

    // 裁切框缩放比例 (1.0 为贴顶底高度)
    const [boxScale, setBoxScale] = useState(1.0);

    // 计算当前比例系数
    const getTargetAspectRatio = useCallback(() => {
        if (!portraitRatio) return 9 / 16;
        const [rw, rh] = portraitRatio.split(':').map(Number);
        return (rw && rh) ? (rw / rh) : (9 / 16);
    }, [portraitRatio]);

    // ===== 1. 视频加载与播放器挂载（TS 格式 mpegts.js / MP4 原生硬解） =====
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !videoSource) return;

        // 清理旧的 mpegts player
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
            // 使用 mpegts.js 播放本地 TS 流
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

        const cWidth = container.clientWidth;
        const cHeight = container.clientHeight;
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

        const aspect = getTargetAspectRatio();
        // 框高度受 boxScale 调节，最高为当前渲染视频的高
        const bHeight = dHeight * boxScale;
        let bWidth = bHeight * aspect;

        // 如果超出视频宽度，等比缩小
        if (bWidth > dWidth) {
            bWidth = dWidth;
        }

        const maxOffsetX = Math.max(0, (dWidth - bWidth) / 2);
        // cropOffset 在 -1 到 1 之间
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
    }, [videoDimensions, boxScale, cropOffset, getTargetAspectRatio]);

    // 监听容器大小变更
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver(() => {
            updateLayout();
        });
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
        isClick: true,
    });

    const stepEngine = useCallback(() => {
        const state = steppingRef.current;
        if (!state.active) return;

        const video = videoRef.current;
        if (!video) return;

        const now = performance.now();
        const elapsed = now - state.startTime;

        // 前 180ms 内认为是单击，只步进 1 帧后等待长按判断
        if (elapsed < 180) {
            state.rafId = requestAnimationFrame(stepEngine);
            return;
        }

        // 超过 180ms，进入长按连续平滑递增提速模式
        state.isClick = false;

        // 速度递增曲线：
        // 200ms ~ 800ms: 1x 速度逐帧放映 (~1.0s/秒)
        // 800ms ~ 2000ms: 2x ~ 4x 速度
        // > 2000ms: 8x ~ 16x 速度
        let rate = 1.0;
        if (elapsed > 2000) {
            rate = 8.0 + Math.min(8.0, (elapsed - 2000) / 500); // 最高 16x
        } else if (elapsed > 800) {
            rate = 2.0 + ((elapsed - 800) / 1200) * 4.0; // 2x ~ 6x
        } else {
            rate = 1.0;
        }

        // 如果浏览器正在激烈 seek 中，稍微让渡微小节拍以防卡死
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

        // 如果正在播放，先暂停以进行逐帧精选
        if (!video.paused) {
            video.pause();
            setIsPlaying(false);
        }

        // 立即执行一次精准单帧步进 (以 1/30 秒为基准)
        const singleFrameDelta = 1 / 30;
        video.currentTime = Math.max(0, Math.min(video.duration || 999999, video.currentTime + singleFrameDelta * direction));

        const state = steppingRef.current;
        state.active = true;
        state.direction = direction;
        state.startTime = performance.now();
        state.isClick = true;

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
        // 侧键后退 (button 3): 快退
        if (e.button === 3) {
            e.preventDefault();
            e.stopPropagation();
            startStepping(-1);
            return;
        }
        // 侧键前进 (button 4): 快进
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

    // 全局防侧键丢失与键盘左右方向键支持
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

        // 快门视觉反馈（80ms 高亮白闪）
        setIsShutterFlashing(true);
        setTimeout(() => setIsShutterFlashing(false), 90);

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const dw = boxLayout.videoWidth;
        const dh = boxLayout.videoHeight;
        if (!dw || !dh) return;

        // 将屏幕上的裁切框矩形映射回视频原始像素坐标
        const scaleX = vw / dw;
        const scaleY = vh / dh;

        const cropScreenX = boxLayout.boxX - boxLayout.videoLeft;
        const cropScreenY = boxLayout.boxY - boxLayout.videoTop;

        const sourceX = Math.max(0, Math.round(cropScreenX * scaleX));
        const sourceY = Math.max(0, Math.round(cropScreenY * scaleY));
        const sourceW = Math.min(vw - sourceX, Math.round(boxLayout.boxWidth * scaleX));
        const sourceH = Math.min(vh - sourceY, Math.round(boxLayout.boxHeight * scaleY));

        // 根据 resolutionPreset 确定最终输出画布尺寸
        let outW = sourceW;
        let outH = sourceH;

        if (resolutionPreset === '1080p') {
            const aspect = getTargetAspectRatio();
            outH = 1920;
            outW = Math.round(outH * aspect);
        } else if (resolutionPreset === '720p') {
            const aspect = getTargetAspectRatio();
            outH = 1280;
            outW = Math.round(outH * aspect);
        }

        // 离线 Canvas 毫秒级直裁
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = outW;
        offscreenCanvas.height = outH;
        const ctx = offscreenCanvas.getContext('2d', { alpha: false });

        // 高质量抗锯齿绘制
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
            video,
            sourceX, sourceY, sourceW, sourceH,
            0, 0, outW, outH
        );

        // 导出高质量图片 Base64
        const base64 = offscreenCanvas.toDataURL('image/jpeg', 0.95);

        if (onShutterCapture) {
            onShutterCapture({
                base64,
                width: outW,
                height: outH,
                timeSec: video.currentTime,
            });
        }
    }, [boxLayout, resolutionPreset, getTargetAspectRatio, onShutterCapture]);

    const handleContextMenu = (e) => {
        // 彻底拦截系统默认菜单，替换为快门截取！
        e.preventDefault();
        e.stopPropagation();
        triggerShutter();
    };

    // ===== 5. 裁切框拖拽与滚轮微调 =====
    const isDraggingCrop = useRef(false);
    const dragStartX = useRef(0);
    const startCropOffset = useRef(0);

    const handleCropMouseDown = (e) => {
        if (e.button !== 0) return; // 仅左键拖动裁切框
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

            // 转化为 -1 到 1 的比率
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
        // 滚轮缩放裁切框
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        setBoxScale(prev => Math.max(0.4, Math.min(1.0, prev + delta)));
    };

    // 播放/暂停切换
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

    // 文件拖拽加载
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
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (onFileLoaded) onFileLoaded(file);
        }
    };

    return (
        <div
            ref={containerRef}
            className={`relative w-full h-full bg-[#0a0c10] flex items-center justify-center select-none overflow-hidden ${
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
            {/* 快门击发白闪 */}
            {isShutterFlashing && (
                <div className="absolute inset-0 bg-white/70 z-50 pointer-events-none transition-opacity duration-75" />
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

            {/* 当没有加载视频时显示拖放提示 */}
            {!videoSource && (
                <div className="flex flex-col items-center justify-center text-slate-500 gap-3 pointer-events-none">
                    <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
                        <Video className="w-12 h-12 text-slate-400 stroke-1" />
                    </div>
                    <p className="text-sm font-medium text-slate-400">将视频拖拽到此处，或点击上方“打开视频”</p>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700">MP4</span>
                        <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700">TS</span>
                        <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700">MKV</span>
                        <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700">WebM</span>
                    </div>
                </div>
            )}

            {/* 视频显示与常驻裁切框层 */}
            {videoSource && boxLayout.videoWidth > 0 && (
                <div
                    className="absolute"
                    style={{
                        left: `${boxLayout.videoLeft}px`,
                        top: `${boxLayout.videoTop}px`,
                        width: `${boxLayout.videoWidth}px`,
                        height: `${boxLayout.videoHeight}px`,
                    }}
                >
                    {/* 视频真实画面 */}
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

                    {/* 暗化非裁剪区域的遮罩层 */}
                    {/* 左遮罩 */}
                    <div
                        className="absolute top-0 bottom-0 left-0 bg-black/65 backdrop-blur-[1px] pointer-events-none transition-all duration-75"
                        style={{
                            width: `${Math.max(0, boxLayout.boxX - boxLayout.videoLeft)}px`,
                        }}
                    />
                    {/* 右遮罩 */}
                    <div
                        className="absolute top-0 bottom-0 right-0 bg-black/65 backdrop-blur-[1px] pointer-events-none transition-all duration-75"
                        style={{
                            width: `${Math.max(0, boxLayout.videoWidth - (boxLayout.boxX - boxLayout.videoLeft + boxLayout.boxWidth))}px`,
                        }}
                    />
                    {/* 上遮罩 */}
                    <div
                        className="absolute left-0 right-0 top-0 bg-black/65 backdrop-blur-[1px] pointer-events-none"
                        style={{
                            height: `${Math.max(0, boxLayout.boxY - boxLayout.videoTop)}px`,
                            left: `${boxLayout.boxX - boxLayout.videoLeft}px`,
                            width: `${boxLayout.boxWidth}px`,
                        }}
                    />
                    {/* 下遮罩 */}
                    <div
                        className="absolute left-0 right-0 bottom-0 bg-black/65 backdrop-blur-[1px] pointer-events-none"
                        style={{
                            height: `${Math.max(0, boxLayout.videoHeight - (boxLayout.boxY - boxLayout.videoTop + boxLayout.boxHeight))}px`,
                            left: `${boxLayout.boxX - boxLayout.videoLeft}px`,
                            width: `${boxLayout.boxWidth}px`,
                        }}
                    />

                    {/* 可拖拽裁切框 */}
                    <div
                        className="absolute cursor-grab active:cursor-grabbing border-2 border-emerald-400/90 shadow-[0_0_15px_rgba(52,211,153,0.3)] hover:border-emerald-300 transition-colors"
                        style={{
                            left: `${boxLayout.boxX - boxLayout.videoLeft}px`,
                            top: `${boxLayout.boxY - boxLayout.videoTop}px`,
                            width: `${boxLayout.boxWidth}px`,
                            height: `${boxLayout.boxHeight}px`,
                        }}
                        onMouseDown={handleCropMouseDown}
                    >
                        {/* 构图三等分辅助线 */}
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

                        {/* 中心准心 */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40">
                            <Crosshair className="w-5 h-5 text-emerald-400" />
                        </div>

                        {/* 四角精致指示标 */}
                        <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-emerald-400" />
                        <div className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-emerald-400" />
                        <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-emerald-400" />
                        <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-emerald-400" />

                        {/* 比例与分辨率提示小气泡 */}
                        <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/75 border border-emerald-500/40 text-[11px] font-mono text-emerald-300 pointer-events-none backdrop-blur-sm">
                            {portraitRatio}
                        </div>
                    </div>
                </div>
            )}

            {/* 底部悬浮操控反馈胶囊 */}
            {videoSource && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-full bg-slate-900/85 backdrop-blur-md border border-slate-700/80 shadow-2xl text-xs text-slate-300 z-30">
                    <button
                        onClick={togglePlay}
                        className="px-2.5 py-1 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 font-medium transition"
                    >
                        {isPlaying ? '暂停' : '播放'}
                    </button>
                    <span className="font-mono text-slate-400">
                        {Math.floor(currentTime / 60)}:{(Math.floor(currentTime % 60)).toString().padStart(2, '0')} / {Math.floor(duration / 60)}:{(Math.floor(duration % 60)).toString().padStart(2, '0')}
                    </span>
                    <div className="h-3 w-px bg-slate-700" />
                    <button
                        onClick={() => {
                            if (onCropOffsetChange) onCropOffsetChange(0);
                            setBoxScale(1.0);
                        }}
                        className="flex items-center gap-1 hover:text-white transition"
                        title="居中裁切框"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>居中</span>
                    </button>
                    <div className="h-3 w-px bg-slate-700" />
                    <button
                        onClick={triggerShutter}
                        className="flex items-center gap-1 px-3 py-1 rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold shadow transition"
                    >
                        快门 (右键)
                    </button>
                </div>
            )}
        </div>
    );
}
