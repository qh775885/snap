import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Video, Film, Play, Pause, RotateCcw, Crosshair, ChevronLeft, ChevronRight, Maximize2, Crop } from 'lucide-react';
import mpegts from 'mpegts.js';

export function VideoStage({
    videoSource,       // File 对象或本地路径字符串
    videoMeta,         // { name, path }
    onFileLoaded,      // 拖拽或选择新视频
    cropMode = 'full', // 'full' (全屏原画) | 'free' (自由框选) | '9:16' | '3:4' | '1:1' | '4:5'
    onCropModeChange,  // 构图模式切换回调 (mode => void)
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

    // ===== 2. 视频元数据就绪与首帧激活 =====
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

        // 彻底解决首帧黑屏：微小步进 0.001 秒强制激活 GPU 渲染管线，第一秒第一帧画面瞬间立现！
        try {
            if (video.currentTime < 0.001) {
                video.currentTime = 0.001;
            }
        } catch (e) {
            console.warn('首帧激活微调跳过:', e);
        }
    };

    const handleLoadedData = () => {
        const video = videoRef.current;
        if (!video) return;
        try {
            if (video.currentTime < 0.001) {
                video.currentTime = 0.001;
            }
        } catch {}
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

    // ===== 3. 人体工学级平滑步进引擎（点按 0.15s 微动，长按原生 GPU 倍速放映/倒带，松手瞬间急停） =====
    const steppingRef = useRef({
        active: false,
        direction: 1, // 1: 前进, -1: 后退
        startTime: 0,
        isFastForwarding: false,
        isRewinding: false,
        lastRewindTime: 0,
        rafId: null,
    });

    const stepEngine = useCallback(() => {
        const state = steppingRef.current;
        if (!state.active) return;

        const video = videoRef.current;
        if (!video) return;

        const now = performance.now();
        const elapsed = now - state.startTime;

        // 前 200ms 为单击点按判定缓冲期（按下瞬间已零延迟完成一次 0.15s 步进）
        if (elapsed < 200) {
            state.rafId = requestAnimationFrame(stepEngine);
            return;
        }

        // 按住超过 200ms，无缝进入长按动态连续模式
        if (state.direction === 1) {
            // 前进：利用原生 GPU 硬件加速倍速播放，彻底根除硬 seek 的卡顿感
            if (!state.isFastForwarding) {
                state.isFastForwarding = true;
                video.muted = true;
                video.playbackRate = 2.0;
                video.play().catch(() => {});
                setIsPlaying(true);
            }

            // 阶梯式平滑提速：按得越久越快
            if (elapsed > 2500) {
                video.playbackRate = 10.0; // 极速赶路
            } else if (elapsed > 1000) {
                video.playbackRate = 5.0;  // 快速掠过
            } else {
                video.playbackRate = 2.0;  // 丝滑放映，微表情尽收眼底
            }
        } else {
            // 后退：启动硬件级自驱动倒带流水线（以微帧 0.04s 顺滑倒放，绝不卡顿）
            if (!state.isRewinding) {
                state.isRewinding = true;
                if (!video.paused) {
                    video.pause();
                    setIsPlaying(false);
                }
                // 触发首步倒退，后续由 onSeeked 紧密接力自驱动
                const nextTime = Math.max(0, video.currentTime - 0.04);
                video.currentTime = nextTime;
                setCurrentTime(nextTime);
            }
        }

        state.rafId = requestAnimationFrame(stepEngine);
    }, []);

    // 硬件解码级倒带接力：上一帧 GPU 渲染完成 (seeked)，紧随垂直同步无缝下发下一微帧
    const handleSeeked = useCallback(() => {
        const state = steppingRef.current;
        if (state.active && state.direction === -1 && state.isRewinding) {
            const video = videoRef.current;
            if (!video || video.currentTime <= 0) return;

            const now = performance.now();
            const elapsed = now - state.startTime;

            // 根据长按时间平滑提速
            let speedMultiplier = 1.0;
            if (elapsed > 2500) {
                speedMultiplier = 3.5; // 极速倒退
            } else if (elapsed > 1000) {
                speedMultiplier = 2.0; // 较快倒退
            } else {
                speedMultiplier = 1.0; // 基础丝滑倒放 (~2x 速率)
            }

            const step = 0.04 * speedMultiplier;
            const nextTime = Math.max(0, video.currentTime - step);

            requestAnimationFrame(() => {
                if (steppingRef.current.active && steppingRef.current.direction === -1 && steppingRef.current.isRewinding) {
                    video.currentTime = nextTime;
                    setCurrentTime(nextTime);
                }
            });
        }
    }, []);

    const startStepping = useCallback((direction) => {
        const video = videoRef.current;
        if (!video) return;

        // 1. 按下瞬间 0 毫秒即时响应：跳动 0.15 秒（约 4~5 帧的动作微演进），大拇指点按手感清脆
        const stepDelta = 0.15 * direction;
        const targetTime = Math.max(0, Math.min(video.duration || 999999, video.currentTime + stepDelta));
        video.currentTime = targetTime;
        setCurrentTime(targetTime);

        if (!video.paused) {
            video.pause();
            setIsPlaying(false);
        }

        // 2. 启动长按检测
        const state = steppingRef.current;
        state.active = true;
        state.direction = direction;
        state.startTime = performance.now();
        state.isFastForwarding = false;
        state.isRewinding = false;
        state.lastRewindTime = performance.now();

        if (state.rafId) cancelAnimationFrame(state.rafId);
        state.rafId = requestAnimationFrame(stepEngine);
    }, [stepEngine]);

    const stopStepping = useCallback(() => {
        const state = steppingRef.current;
        if (!state.active) return;
        state.active = false;

        if (state.rafId) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }

        const video = videoRef.current;
        if (video) {
            // 松手瞬间 0 毫秒物理急停，定格在当前帧
            if (state.isFastForwarding) {
                video.pause();
                video.playbackRate = 1.0;
                setIsPlaying(false);
                setCurrentTime(video.currentTime);
            }
            if (state.isRewinding) {
                setCurrentTime(video.currentTime);
            }
        }

        state.isFastForwarding = false;
        state.isRewinding = false;
    }, []);

    // 监听鼠标侧键（调换方向：button 3 快进，button 4 快退）
    const handlePointerDown = (e) => {
        if (e.button === 3) {
            e.preventDefault();
            e.stopPropagation();
            startStepping(1);
            return;
        }
        if (e.button === 4) {
            e.preventDefault();
            e.stopPropagation();
            startStepping(-1);
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
        window.addEventListener('blur', stopStepping);

        return () => {
            window.removeEventListener('pointerup', onGlobalMouseUp);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', stopStepping);
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

        // 100% 原始物理像素高保真无损输出
        const outW = sourceW;
        const outH = sourceH;

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

        const base64 = offscreenCanvas.toDataURL('image/jpeg', 0.98);

        if (onShutterCapture) {
            onShutterCapture({
                base64,
                width: outW,
                height: outH,
                timeSec: video.currentTime,
            });
        }
    }, [boxLayout, cropMode, onShutterCapture]);

    const handleContextMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerShutter();
    };

    // ===== 5. 裁切框边角拖动调整 (自由比例模式切换与缩放) =====
    const handleResizeMouseDown = (direction, e) => {
        if (e.button !== 0 || cropMode === 'full') return;
        e.preventDefault();
        e.stopPropagation();

        const vw = boxLayout.videoWidth;
        const vh = boxLayout.videoHeight;
        if (!vw || !vh) return;

        // 获取当前框在视频内的归一化比例坐标
        let startRect;
        if (cropMode === 'free') {
            startRect = { ...freeCropRect };
        } else {
            // 从固定比例无缝切入自由模式：以当前框的屏幕真实几何为初始比例
            const curX = (boxLayout.boxX - boxLayout.videoLeft) / vw;
            const curY = (boxLayout.boxY - boxLayout.videoTop) / vh;
            const curW = boxLayout.boxWidth / vw;
            const curH = boxLayout.boxHeight / vh;
            startRect = {
                x: Math.max(0, Math.min(1 - curW, curX)),
                y: Math.max(0, Math.min(1 - curH, curY)),
                w: Math.max(0.05, Math.min(1, curW)),
                h: Math.max(0.05, Math.min(1, curH)),
            };
            setFreeCropRect(startRect);
            if (onCropModeChange) {
                onCropModeChange('free');
            }
        }

        const startMouseX = e.clientX;
        const startMouseY = e.clientY;

        const onMouseMove = (moveEvt) => {
            const dx = (moveEvt.clientX - startMouseX) / vw;
            const dy = (moveEvt.clientY - startMouseY) / vh;

            let nextX = startRect.x;
            let nextY = startRect.y;
            let nextW = startRect.w;
            let nextH = startRect.h;

            // 根据拉伸方向更新宽高与位置
            if (direction.includes('e')) {
                nextW = Math.max(0.05, Math.min(1 - startRect.x, startRect.w + dx));
            }
            if (direction.includes('s')) {
                nextH = Math.max(0.05, Math.min(1 - startRect.y, startRect.h + dy));
            }
            if (direction.includes('w')) {
                const maxDx = startRect.w - 0.05;
                const clampedDx = Math.max(-startRect.x, Math.min(maxDx, dx));
                nextX = startRect.x + clampedDx;
                nextW = startRect.w - clampedDx;
            }
            if (direction.includes('n')) {
                const maxDy = startRect.h - 0.05;
                const clampedDy = Math.max(-startRect.y, Math.min(maxDy, dy));
                nextY = startRect.y + clampedDy;
                nextH = startRect.h - clampedDy;
            }

            setFreeCropRect({
                x: Math.max(0, Math.min(1 - nextW, nextX)),
                y: Math.max(0, Math.min(1 - nextH, nextY)),
                w: nextW,
                h: nextH,
            });
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    // 裁切框内部拖动平移
    const isDraggingCrop = useRef(false);
    const dragStartX = useRef(0);
    const startCropOffset = useRef(0);

    const handleCropMouseDown = (e) => {
        if (e.button !== 0 || cropMode === 'full') return;
        e.preventDefault();
        e.stopPropagation();

        if (cropMode === 'free') {
            const vw = boxLayout.videoWidth;
            const vh = boxLayout.videoHeight;
            if (!vw || !vh) return;

            const startX = freeCropRect.x;
            const startY = freeCropRect.y;
            const startMouseX = e.clientX;
            const startMouseY = e.clientY;

            const onMouseMove = (moveEvt) => {
                const dx = (moveEvt.clientX - startMouseX) / vw;
                const dy = (moveEvt.clientY - startMouseY) / vh;

                const nextX = Math.max(0, Math.min(1 - freeCropRect.w, startX + dx));
                const nextY = Math.max(0, Math.min(1 - freeCropRect.h, startY + dy));

                setFreeCropRect(prev => ({
                    ...prev,
                    x: nextX,
                    y: nextY,
                }));
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
            return;
        }

        // 固定比例模式下：原有左右平移
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

        if (cropMode === 'free') {
            setFreeCropRect(prev => {
                const newW = Math.max(0.08, Math.min(1.0, prev.w * (1 + delta)));
                const newH = Math.max(0.08, Math.min(1.0, prev.h * (1 + delta)));
                const newX = Math.max(0, Math.min(1 - newW, prev.x + (prev.w - newW) / 2));
                const newY = Math.max(0, Math.min(1 - newH, prev.y + (prev.h - newH) / 2));
                return { x: newX, y: newY, w: newW, h: newH };
            });
            return;
        }

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
            className={`relative w-full h-full bg-[#07080a] flex flex-col items-center justify-between select-none overflow-hidden ${
                isDragOver ? 'ring-1 ring-zinc-400 bg-zinc-900/30' : ''
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
                <div className="absolute inset-0 bg-white/70 z-50 pointer-events-none transition-opacity duration-75" />
            )}

            {/* 主工作视口区域：居中呈现 */}
            <div className="flex-1 w-full relative overflow-hidden flex items-center justify-center bg-[#050608]">
                {/* 未加载视频时的引导 */}
                {!videoSource && (
                    <div className="flex flex-col items-center justify-center text-zinc-500 gap-4 pointer-events-none p-8 text-center max-w-sm">
                        <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-white/[0.08] flex items-center justify-center shadow-lg text-zinc-400">
                            <Film className="w-6 h-6 stroke-[1.5]" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-zinc-200">拖入本地视频文件即可取景</p>
                            <p className="text-xs text-zinc-500">支持 MP4、TS、MKV、WebM、MOV 等全部主流格式</p>
                        </div>
                    </div>
                )}

                {/* 加载视频后的舞台画面 */}
                {videoSource && (
                    <div
                        className="relative overflow-hidden flex items-center justify-center"
                        style={{
                            width: boxLayout.videoWidth > 0 ? `${boxLayout.videoWidth}px` : '100%',
                            height: boxLayout.videoHeight > 0 ? `${boxLayout.videoHeight}px` : '100%',
                        }}
                    >
                        {/* 原生 GPU 硬件加速视频播放器 */}
                        <video
                            ref={videoRef}
                            className="w-full h-full block object-contain pointer-events-none bg-black"
                            crossOrigin="anonymous"
                            playsInline
                            preload="auto"
                            onLoadedMetadata={handleLoadedMetadata}
                            onLoadedData={handleLoadedData}
                            onSeeked={handleSeeked}
                            onTimeUpdate={() => {
                                const t = videoRef.current?.currentTime || 0;
                                setCurrentTime(t);
                                if (onTimeUpdate) onTimeUpdate(t);
                            }}
                            onEnded={() => setIsPlaying(false)}
                        />

                        {/* 如果是裁剪模式（9:16/3:4/1:1/4:5/free），显示半透明暗色遮罩与构图框 */}
                        {cropMode !== 'full' && boxLayout.videoWidth > 0 && (
                            <>
                                {/* 左遮罩 */}
                                <div
                                    className="absolute top-0 bottom-0 left-0 bg-black/70 pointer-events-none transition-all duration-75"
                                    style={{ width: `${Math.max(0, boxLayout.boxX - boxLayout.videoLeft)}px` }}
                                />
                                {/* 右遮罩 */}
                                <div
                                    className="absolute top-0 bottom-0 right-0 bg-black/70 pointer-events-none transition-all duration-75"
                                    style={{ width: `${Math.max(0, boxLayout.videoWidth - (boxLayout.boxX - boxLayout.videoLeft + boxLayout.boxWidth))}px` }}
                                />
                                {/* 上遮罩 */}
                                <div
                                    className="absolute left-0 right-0 top-0 bg-black/70 pointer-events-none"
                                    style={{
                                        height: `${Math.max(0, boxLayout.boxY - boxLayout.videoTop)}px`,
                                        left: `${boxLayout.boxX - boxLayout.videoLeft}px`,
                                        width: `${boxLayout.boxWidth}px`,
                                    }}
                                />
                                {/* 下遮罩 */}
                                <div
                                    className="absolute left-0 right-0 bottom-0 bg-black/70 pointer-events-none"
                                    style={{
                                        height: `${Math.max(0, boxLayout.videoHeight - (boxLayout.boxY - boxLayout.videoTop + boxLayout.boxHeight))}px`,
                                        left: `${boxLayout.boxX - boxLayout.videoLeft}px`,
                                        width: `${boxLayout.boxWidth}px`,
                                    }}
                                />

                                {/* 裁切框：现代工业级取景框设计（支持边角自由缩放拖拉） */}
                                <div
                                    className="absolute cursor-grab active:cursor-grabbing border border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
                                    style={{
                                        left: `${boxLayout.boxX - boxLayout.videoLeft}px`,
                                        top: `${boxLayout.boxY - boxLayout.videoTop}px`,
                                        width: `${boxLayout.boxWidth}px`,
                                        height: `${boxLayout.boxHeight}px`,
                                    }}
                                    onMouseDown={handleCropMouseDown}
                                >
                                    {/* 四角精密 L 型取景标 (Corner Marks) */}
                                    <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t-2 border-l-2 border-white pointer-events-none" />
                                    <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t-2 border-r-2 border-white pointer-events-none" />
                                    <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b-2 border-l-2 border-white pointer-events-none" />
                                    <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b-2 border-r-2 border-white pointer-events-none" />

                                    {/* 三等分九宫格辅助线 */}
                                    <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 opacity-20">
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
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
                                        <Crosshair className="w-4 h-4 text-white" />
                                    </div>

                                    {/* 比例指示微标 */}
                                    <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/70 border border-white/10 text-[10px] font-mono text-zinc-300 pointer-events-none backdrop-blur-md">
                                        {cropMode === 'free' ? '自由' : cropMode}
                                    </div>

                                    {/* 自由拖拽缩放手柄：四角 */}
                                    <div
                                        className="absolute -top-1.5 -left-1.5 w-4 h-4 cursor-nwse-resize z-20 group"
                                        onMouseDown={(e) => handleResizeMouseDown('nw', e)}
                                    />
                                    <div
                                        className="absolute -top-1.5 -right-1.5 w-4 h-4 cursor-nesw-resize z-20 group"
                                        onMouseDown={(e) => handleResizeMouseDown('ne', e)}
                                    />
                                    <div
                                        className="absolute -bottom-1.5 -left-1.5 w-4 h-4 cursor-nesw-resize z-20 group"
                                        onMouseDown={(e) => handleResizeMouseDown('sw', e)}
                                    />
                                    <div
                                        className="absolute -bottom-1.5 -right-1.5 w-4 h-4 cursor-nwse-resize z-20 group"
                                        onMouseDown={(e) => handleResizeMouseDown('se', e)}
                                    />

                                    {/* 自由拖拽缩放手柄：四边 */}
                                    <div
                                        className="absolute -top-1.5 left-3 right-3 h-3 cursor-ns-resize z-10 flex items-center justify-center group"
                                        onMouseDown={(e) => handleResizeMouseDown('n', e)}
                                    >
                                        <div className="w-6 h-0.5 rounded-full bg-white/40 group-hover:bg-white transition-colors" />
                                    </div>
                                    <div
                                        className="absolute -bottom-1.5 left-3 right-3 h-3 cursor-ns-resize z-10 flex items-center justify-center group"
                                        onMouseDown={(e) => handleResizeMouseDown('s', e)}
                                    >
                                        <div className="w-6 h-0.5 rounded-full bg-white/40 group-hover:bg-white transition-colors" />
                                    </div>
                                    <div
                                        className="absolute -left-1.5 top-3 bottom-3 w-3 cursor-ew-resize z-10 flex items-center justify-center group"
                                        onMouseDown={(e) => handleResizeMouseDown('w', e)}
                                    >
                                        <div className="h-6 w-0.5 rounded-full bg-white/40 group-hover:bg-white transition-colors" />
                                    </div>
                                    <div
                                        className="absolute -right-1.5 top-3 bottom-3 w-3 cursor-ew-resize z-10 flex items-center justify-center group"
                                        onMouseDown={(e) => handleResizeMouseDown('e', e)}
                                    >
                                        <div className="h-6 w-0.5 rounded-full bg-white/40 group-hover:bg-white transition-colors" />
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* 专业级视频进度条与播放控制底栏 */}
            {videoSource && (
                <div className="w-full bg-[#0d0e11]/95 border-t border-white/[0.07] px-4 py-2 flex flex-col gap-1.5 z-30 shrink-0 select-none">
                    {/* 交互式进度条 */}
                    <div
                        ref={progressBarRef}
                        onMouseDown={handleProgressBarMouseDown}
                        onMouseMove={handleProgressBarMouseMove}
                        onMouseLeave={() => setScrubHoverTime(null)}
                        className="relative h-1.5 hover:h-2.5 bg-zinc-800 rounded-full cursor-pointer transition-all flex items-center group"
                    >
                        {/* 播放进度填色 */}
                        <div
                            className="h-full bg-zinc-200 rounded-full relative"
                            style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                        >
                            {/* 进度滑块圆点 */}
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow border border-zinc-950 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>

                        {/* 悬浮时间预览气泡 */}
                        {scrubHoverTime !== null && (
                            <div
                                className="absolute -top-6 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[10px] font-mono text-zinc-200 pointer-events-none -translate-x-1/2 shadow-lg"
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
                                className="p-1 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 font-bold transition shadow-sm"
                                title="播放 / 暂停 (空格键)"
                            >
                                {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                            </button>

                            {/* 单帧后退/前进 */}
                            <button
                                onClick={() => startStepping(-1)}
                                className="p-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-white/[0.06] transition"
                                title="微调后退 (侧键后退 / 左方向键)"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={() => startStepping(1)}
                                className="p-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-white/[0.06] transition"
                                title="微调前进 (侧键前进 / 右方向键)"
                            >
                                <ChevronRight className="w-3.5 h-3.5" />
                            </button>

                            {/* 时间戳与总时长 */}
                            <div className="flex items-center gap-1.5 font-mono text-zinc-400 ml-2 text-xs">
                                <span className="text-zinc-100 font-semibold">{formatSeconds(currentTime)}</span>
                                <span className="text-zinc-600">/</span>
                                <span className="text-zinc-500">{formatSeconds(duration)}</span>
                            </div>
                        </div>

                        {/* 右侧快门击发与居中 */}
                        <div className="flex items-center gap-2">
                            {cropMode !== 'full' && (
                                <button
                                    onClick={() => {
                                        if (cropMode === 'free') {
                                            setFreeCropRect(prev => ({
                                                ...prev,
                                                x: Math.max(0, (1 - prev.w) / 2),
                                                y: Math.max(0, (1 - prev.h) / 2),
                                            }));
                                        } else {
                                            if (onCropOffsetChange) onCropOffsetChange(0);
                                            setBoxScale(1.0);
                                        }
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-white/[0.06] transition text-xs"
                                    title="裁切框恢复居中"
                                >
                                    <RotateCcw className="w-3 h-3" />
                                    <span>居中</span>
                                </button>
                            )}

                            <button
                                onClick={triggerShutter}
                                className="flex items-center gap-1.5 px-3.5 py-1 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs shadow-sm transition active:scale-95"
                                title="截取当前高保真画面 (鼠标右键 / S 键)"
                            >
                                <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                                <span>快门</span>
                                <span className="text-[10px] font-mono text-zinc-500 font-normal">右键</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
