import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, FastForward, Image as ImageIcon, Zap, Scissors, Settings, FolderOpen, Loader2, ScanLine, Hash, X, BrainCircuit } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { VideoStage } from './components/VideoStage';

// Helper for time formatting
const formatTime = (seconds) => {
    if (!seconds) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')} `;
};

// ====== v2.1.1 智能推荐张数：幂律缩放 + fps 修正 ======
// 基础：d^0.6 × 3.5（实测拟合）
// fps 修正：高帧率视频冗余帧更多且处理更慢，适当降低
const getRecommendedCount = (durationSec, videoFps = 30) => {
    if (!durationSec || durationSec <= 0) return 10;
    const fpsFactor = Math.pow(30 / Math.max(24, videoFps), 0.3); // 30fps→1.0, 60fps→0.81
    const raw = Math.round(Math.pow(durationSec, 0.6) * 3.5 * fpsFactor);
    return Math.max(10, raw);
};

// ====== 清晰度评分：Laplacian 方差（值越高越清晰） ======
const computeSharpness = (canvas) => {
    // 160px 宽度快速计算，清晰度过滤已证明有效，速度优先
    const scale = Math.min(1, 160 / canvas.width);
    const w = Math.round(canvas.width * scale);
    const h = Math.round(canvas.height * scale);
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    const tmpCtx = tmpCanvas.getContext('2d', { willReadFrequently: true });
    tmpCtx.drawImage(canvas, 0, 0, w, h);
    const imgData = tmpCtx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        gray[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
    }
    let sum = 0, count = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const lap = -4 * gray[y * w + x]
                + gray[(y - 1) * w + x]
                + gray[(y + 1) * w + x]
                + gray[y * w + (x - 1)]
                + gray[y * w + (x + 1)];
            sum += lap * lap;
            count++;
        }
    }
    return count > 0 ? sum / count : 0;
};

// ====== 感知哈希 dHash：捕捉图像结构，不受位置平移影响 ======
const computeDHash = (canvas) => {
    const w = 17, h = 16; // 17宽取16个水平梯度差
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const ctx = tmp.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const hash = new Uint8Array(256); // 16×16 = 256 bits
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w - 1; x++) {
            const i1 = (y * w + x) * 4;
            const i2 = (y * w + x + 1) * 4;
            const g1 = data[i1] * 0.299 + data[i1 + 1] * 0.587 + data[i1 + 2] * 0.114;
            const g2 = data[i2] * 0.299 + data[i2 + 1] * 0.587 + data[i2 + 2] * 0.114;
            hash[y * 16 + x] = g1 > g2 ? 1 : 0;
        }
    }
    return hash;
};

// ====== 有效画面检测：过滤黑屏、片头 logo、内容占比过低的帧 ======
const analyzeFrameContent = (canvas) => {
    const scale = Math.min(1, 96 / canvas.width);
    const w = Math.max(24, Math.round(canvas.width * scale));
    const h = Math.max(24, Math.round(canvas.height * scale));
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    const ctx = tmpCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    let darkPixels = 0;
    let activePixels = 0;
    let lumaSum = 0;
    let centerActivePixels = 0;
    let textLikePixels = 0;

    const centerLeft = Math.floor(w * 0.2);
    const centerRight = Math.ceil(w * 0.8);
    const centerTop = Math.floor(h * 0.22);
    const centerBottom = Math.ceil(h * 0.78);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            const idx = i * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const luma = r * 0.299 + g * 0.587 + b * 0.114;
        lumaSum += luma;

        if (luma < 18) darkPixels++;

        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        const isActive = luma > 26 || spread > 22;
        if (isActive) {
            activePixels++;
        }

            const inCenter = x >= centerLeft && x < centerRight && y >= centerTop && y < centerBottom;
            if (inCenter && isActive) {
                centerActivePixels++;
            }

            if (inCenter && luma > 155 && spread < 36) {
                textLikePixels++;
            }
        }
    }

    const total = w * h;
    const darkRatio = darkPixels / total;
    const activeRatio = activePixels / total;
    const avgLuma = lumaSum / total;
    const centerArea = (centerRight - centerLeft) * (centerBottom - centerTop);
    const centerActiveRatio = centerArea > 0 ? centerActivePixels / centerArea : 0;
    const textLikeRatio = centerArea > 0 ? textLikePixels / centerArea : 0;
    const overlayPenalty = Math.min(1, textLikeRatio * 10 + Math.max(0, 0.12 - centerActiveRatio) * 2.5);
    const looksLikeIntroOverlay = (darkRatio > 0.72 && textLikeRatio > 0.035) || (textLikeRatio > 0.08 && centerActiveRatio < 0.22);
    const isUsable = darkRatio < 0.94 && activeRatio > 0.08 && avgLuma > 10 && !looksLikeIntroOverlay;

    return { darkRatio, activeRatio, avgLuma, centerActiveRatio, textLikeRatio, overlayPenalty, looksLikeIntroOverlay, isUsable };
};

const computeSelectionScore = ({ sharpness, activeRatio, darkRatio, centerActiveRatio, overlayPenalty }) => {
    return Math.log1p(Math.max(0, sharpness)) * 0.55
        + activeRatio * 140
        + centerActiveRatio * 100
        - darkRatio * 30
        - overlayPenalty * 65;
};

const getSharpnessFloor = (values) => {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.max(0, Math.floor(sorted.length * 0.35) - 1);
    return Math.max(55, sorted[idx]);
};

// ====== Hamming 距离：两个哈希有多少位不同（越大越不同） ======
const hashDistance = (a, b) => {
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) dist++;
    }
    return dist;
};

// ====== 从文件路径加载图片到 HTMLImageElement ======
const loadImageFromPath = (filePath) => {
    return new Promise((resolve, reject) => {
        const fs = window.require('fs');
        try {
            const buffer = fs.readFileSync(filePath);
            const blob = new Blob([buffer], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error(`Failed to load image: ${filePath}`));
            };
            img.src = url;
        } catch (err) {
            reject(new Error(`Failed to read image file: ${filePath} - ${err.message}`));
        }
    });
};

const loadImageFromUrl = (url) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image from url: ${url}`));
        img.src = url;
    });
};

// Shell Layout
const TRACKABLE_CLASSES = [
    'person', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe',
    'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat'
];

function App() {
    // --- Core Video State ---
    const [videoFile, setVideoFile] = useState(null);
    const [videoRefVal, setVideoRefVal] = useState(null); // Ref from child
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    // Global drag prevention is now fully handled in index.html to guarantee 0-ms startup

    // --- Tool State ---
    const [frames, setFrames] = useState([]);
    const [seekStep, setSeekStep] = useState(5);
    const [cacheDir, setCacheDir] = useState("");
    const [portraitRatio, setPortraitRatio] = useState(null);
    const [cropOffset, setCropOffset] = useState(0);

    // Extraction Range & Density
    const [rangeStart, setRangeStart] = useState(0);
    const [rangeEnd, setRangeEnd] = useState(0); // If 0/null, use duration
    const [multiplier, setMultiplier] = useState(1); // Density: frames per second
    const [targetCount, setTargetCount] = useState(12);
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractElapsed, setExtractElapsed] = useState(0); // 提取用时（秒）
    const [extractStatus, setExtractStatus] = useState(''); // 提取阶段文字
    const extractTimerRef = useRef(null);
    const [captureNotice, setCaptureNotice] = useState('');
    const captureNoticeTimerRef = useRef(null);

    const [isVideoLoading, setIsVideoLoading] = useState(false);
    const [fps, setFps] = useState(30);

    // Sync end range when duration loads — 使用智能推荐张数
    // 去掉 rangeEnd===0 条件，每次 duration 变化都重新同步（修复切换视频时范围不更新）
    useEffect(() => {
        if (duration > 0) {
            setRangeStart(0);
            setRangeEnd(duration);
            const recommended = getRecommendedCount(duration, fps);
            setTargetCount(recommended);
            setMultiplier(parseFloat((recommended / duration).toFixed(1)) || 1);
        }
    }, [duration, fps]);

    // Handlers for Range — 区间变化时重新推荐张数
    const handleSetStart = () => {
        const t = videoRefVal ? videoRefVal.currentTime : 0;
        const newStart = Math.min(t, rangeEnd);
        setRangeStart(newStart);
        const rangeDuration = rangeEnd - newStart;
        if (rangeDuration > 0) {
            const recommended = getRecommendedCount(rangeDuration, fps);
            setTargetCount(recommended);
        }
    };
    const handleSetEnd = () => {
        const t = videoRefVal ? videoRefVal.currentTime : duration;
        const newEnd = Math.max(t, rangeStart);
        setRangeEnd(newEnd);
        const rangeDuration = newEnd - rangeStart;
        if (rangeDuration > 0) {
            const recommended = getRecommendedCount(rangeDuration, fps);
            setTargetCount(recommended);
        }
    };
    const handleResetRange = () => {
        setRangeStart(0);
        setRangeEnd(duration);
        const recommended = getRecommendedCount(duration, fps);
        setTargetCount(recommended);
    };

    // Handler for Multiplier Change -> Auto set Count
    const handleMultiplierChange = (val) => {
        setMultiplier(val);
        updateCountFromMultiplier(val, rangeStart, rangeEnd);
    };

    const updateCountFromMultiplier = (mult, start, end) => {
        if (!mult || isNaN(mult)) return; // Don't update if invalid
        const dur = end - start;
        if (dur > 0) {
            setTargetCount(Math.max(1, Math.round(dur * mult)));
        }
    };

    // Handler for Count Change -> Update Multiplier display? (Optional, maybe just let them diverge)
    const handleTargetCountChange = (val) => {
        setTargetCount(val);
        // Reverse calc multiplier for display? nah, keep it simple.
    };

    const showCaptureNotice = (text) => {
        if (captureNoticeTimerRef.current) {
            clearTimeout(captureNoticeTimerRef.current);
        }
        setCaptureNotice(text);
        captureNoticeTimerRef.current = setTimeout(() => {
            setCaptureNotice('');
            captureNoticeTimerRef.current = null;
        }, 1400);
    };

    const handleClear = (deleteLocal = false) => {
        if (deleteLocal && cacheDir && videoFile) {
            try {
                const fs = window.require('fs');
                const path = window.require('path');
                const sanitize = (name) => {
                    const nameNoExt = name.substring(0, name.lastIndexOf('.')) || name;
                    return nameNoExt.replace(/[<>:"/\\|?*]/g, '').replace(/[\s.]+$/g, '').trim();
                };
                const targetDir = path.join(cacheDir, sanitize(videoFile.name));
                if (fs.existsSync(targetDir)) {
                    fs.rmSync(targetDir, { recursive: true, force: true });
                }
            } catch (err) {
                console.error('Delete local folder failed:', err);
            }
        }
        setFrames([]);
    };
    // --- Persistence ---
    useEffect(() => {
        const saved = localStorage.getItem('snap-cache-dir') || localStorage.getItem('video-ppp-cache-dir');
        if (saved) setCacheDir(saved);
    }, []);

    useEffect(() => {
        return () => {
            if (captureNoticeTimerRef.current) {
                clearTimeout(captureNoticeTimerRef.current);
            }
        };
    }, []);

    const handleSelectCache = async () => {
        try {
            const { ipcRenderer } = window.require('electron');
            const path = await ipcRenderer.invoke('select-folder');
            if (path) {
                setCacheDir(path);
                localStorage.setItem('snap-cache-dir', path);
            }
        } catch (e) {
            console.error("Select folder failed:", e);
        }
    };

    const handleDownload = async () => {
        if (!cacheDir) return;
        try {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-folder', cacheDir);
        } catch (e) {
            console.error("Open folder failed:", e);
        }
    };


    // Direct Setter for Portrait Mode
    const setPortraitMode = (mode) => {
        if (portraitRatio === mode) {
            setPortraitRatio(null); // click active again turns it off
        } else {
            setPortraitRatio(mode);
        }
        setCropOffset(0);
    };

    const handleManualCropMove = (offset) => {
        setCropOffset(offset);
    };

    // --- Handlers ---
    const togglePlay = () => {
        if (!videoRefVal) return;
        if (isPlaying) {
            videoRefVal.pause();
        } else {
            videoRefVal.play();
        }
        setIsPlaying(!isPlaying);
    };

    const onTimeUpdate = async (e) => {
        const time = e.target.currentTime;
        setCurrentTime(time);
    };

    const [isVerticalContent, setIsVerticalContent] = useState(false); // Detect if loaded video is vertical

    const onDurationChange = (e) => {
        setDuration(e.target.duration);
        setIsVerticalContent(e.target.videoHeight > e.target.videoWidth);
    };

    const onEnded = () => {
        setIsPlaying(false);
    };

    const handleSeek = (time) => {
        if (videoRefVal) {
            videoRefVal.currentTime = time;
            setCurrentTime(time);
        }
    };

    const handleFileLoaded = async (file) => {
        setIsVideoLoading(true);
        // 重置范围状态，确保新视频不会沿用旧视频的范围
        setRangeStart(0);
        setRangeEnd(0);
        setDuration(0); // 强制归零，确保新视频 duration 变化触发 useEffect 重算推荐张数
        setFrames([]);
        const { ipcRenderer, webUtils } = window.require('electron');
        try {
            // Electron 30+ 隐藏了 file.path，需要用 webUtils 提权获取真实路径
            let loadedPath = file.path;

            // Try fallback reading from file object exactly
            if (!loadedPath && file.webkitRelativePath && file.webkitRelativePath.includes(':')) {
                loadedPath = file.webkitRelativePath;
            }

            if (!loadedPath && webUtils) {
                try {
                    loadedPath = webUtils.getPathForFile(file);
                } catch (err) {
                    console.error("webUtils error:", err);
                }
            }

            if (!loadedPath) {
                alert(`未能提取真实路径！
请检查：
1. 请勿直接从网页、压缩包或者非原生文件管理工具内直接拖出。
2. Windows 下请从「资源管理器(例如 D盘)」内直接拖动文件。
调试信息: File[${file.name}], type[${file.type}], Utils[${!!webUtils}]`);
                setIsVideoLoading(false);
                return;
            }

            // 1. Run through FFmpeg Media Engine to normalize format, fix IDM errors, and ensure compatibility
            loadedPath = await ipcRenderer.invoke('process-media', loadedPath);

            // 2. Extract accurate FPS via ffprobe
            const info = await ipcRenderer.invoke('get-video-info', loadedPath);
            setFps(info.fps > 0 ? info.fps : 30);

            // 3. Keep original name, but substitute the path
            file.loadedPath = loadedPath;
            setVideoFile(file);
        } catch (e) {
            console.error("Video parse err:", e);
            alert("底层解析失败：" + e.message);
            setVideoFile(file); // Fallback to raw file if err
        } finally {
            setIsVideoLoading(false);
        }
    };


    // --- Capture Logic (Smart Crop with Offset) ---
    const captureFrame = async (overrideOffset = null) => {
        if (!videoRefVal || !videoRefVal.videoWidth) return;

        const vWidth = videoRefVal.videoWidth;
        const vHeight = videoRefVal.videoHeight;
        let sx = 0, sy = 0, sWidth = vWidth, sHeight = vHeight;

        const actualCropOffset = overrideOffset !== null ? overrideOffset : cropOffset;

        // Smart Crop Logic
        if (portraitRatio) {
            const ratioParts = portraitRatio.split(':');
            const targetAspect = parseInt(ratioParts[0]) / parseInt(ratioParts[1]);
            const targetWidth = vHeight * targetAspect;
            if (targetWidth <= vWidth) {
                sWidth = targetWidth;
                const maxOffset = (vWidth - sWidth) / 2;
                const currentOffsetPx = actualCropOffset * maxOffset;
                sx = (vWidth - sWidth) / 2 + currentOffsetPx;
            } else {
                sHeight = vWidth / targetAspect;
                sy = (vHeight - sHeight) / 2;
            }
        }

        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            canvas.width = sWidth;
            canvas.height = sHeight;
            const ctx = canvas.getContext('2d');

            ctx.drawImage(videoRefVal, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

            canvas.toBlob(async (blob) => {
                if (!blob) { resolve(); return; }
                const url = URL.createObjectURL(blob);
                const time = videoRefVal.currentTime;

                // Construct Frame Object
                const newFrame = {
                    id: Date.now() + Math.random(),
                    url: url,
                    time: time,
                    blob: blob,
                    isPortrait: !!portraitRatio,
                    ratio: portraitRatio || "16:9",
                    filePath: null
                };

                // Auto-Save if directory is set
                if (cacheDir && videoFile) {
                    try {
                        const fs = window.require('fs');
                        const path = window.require('path');

                        // Helper to sanitize folder name (remove illegal chars and trailing dots/spaces)
                        const sanitize = (name) => {
                            // Remove extension first
                            const nameNoExt = name.substring(0, name.lastIndexOf('.')) || name;
                            return nameNoExt
                                .replace(/[<>:"/\\|?*]/g, '') // Remove illegal chars
                                .replace(/[\s.]+$/g, '')      // Remove trailing spaces/dots (Win issue)
                                .trim();
                        };

                        const subDirName = sanitize(videoFile.name);
                        const targetDir = path.join(cacheDir, subDirName);

                        if (!fs.existsSync(targetDir)) {
                            fs.mkdirSync(targetDir, { recursive: true });
                        }

                        const buffer = Buffer.from(await blob.arrayBuffer());
                        // Filename: frame_MMSS_ms.jpg
                        const m = Math.floor(time / 60).toString().padStart(2, '0');
                        const s = Math.floor(time % 60).toString().padStart(2, '0');
                        const ms = Math.floor((time % 1) * 1000).toString().padStart(3, '0');
                        const filename = `frame_${m}${s}_${ms}.jpg`;
                        const fullPath = path.join(targetDir, filename);

                        fs.writeFileSync(fullPath, buffer);
                        newFrame.filePath = fullPath;
                    } catch (err) {
                        console.error("Auto-save failed:", err);
                    }
                }

                setFrames(prev => [...prev, newFrame]);
                showCaptureNotice(newFrame.filePath ? '已截图并保存' : '已截图（未设置保存目录）');
                resolve();
            }, 'image/jpeg', 0.95);
        });
    };

    const revokeFrames = (items) => {
        for (const item of items) {
            if (item?.url?.startsWith('blob:')) {
                URL.revokeObjectURL(item.url);
            }
        }
    };

    const handleDeleteFrame = (frameId) => {
        setFrames(prev => {
            const target = prev.find(frame => frame.id === frameId);
            if (target?.url?.startsWith('blob:')) {
                URL.revokeObjectURL(target.url);
            }
            if (target?.sourceFrame?.url?.startsWith('blob:')) {
                URL.revokeObjectURL(target.sourceFrame.url);
            }
            return prev.filter(frame => frame.id !== frameId);
        });
    };

    const handleRestoreFrame = (frameId) => {
        setFrames(prev => prev.map(frame => {
            if (frame.id !== frameId || !frame.sourceFrame) return frame;
            if (frame.url?.startsWith('blob:')) {
                URL.revokeObjectURL(frame.url);
            }
            return frame.sourceFrame;
        }));
    };

    // ====== v2.0.9 直接复用 Canvas 保存帧（跳过 re-seek） ======
    const saveCanvasAsFrame = async (canvas, time, options = {}) => {
        const { isPortrait = !!portraitRatio, ratio = portraitRatio || "16:9", append = true, sourceFrameId = null } = options;
        return new Promise((resolve) => {
            canvas.toBlob(async (blob) => {
                if (!blob) { resolve(); return; }
                const url = URL.createObjectURL(blob);
                const newFrame = {
                    id: Date.now() + Math.random(),
                    createdAt: Date.now(),
                    url, time, blob,
                    isPortrait,
                    ratio,
                    sourceFrameId,
                    filePath: null
                };
                if (cacheDir && videoFile) {
                    try {
                        const fs = window.require('fs');
                        const path = window.require('path');
                        const sanitize = (name) => {
                            const nameNoExt = name.substring(0, name.lastIndexOf('.')) || name;
                            return nameNoExt.replace(/[<>:"/\\|?*]/g, '').replace(/[\s.]+$/g, '').trim();
                        };
                        const targetDir = path.join(cacheDir, sanitize(videoFile.name));
                        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
                        const buffer = Buffer.from(await blob.arrayBuffer());
                        const m = Math.floor(time / 60).toString().padStart(2, '0');
                        const s = Math.floor(time % 60).toString().padStart(2, '0');
                        const ms = Math.floor((time % 1) * 1000).toString().padStart(3, '0');
                        const fullPath = path.join(targetDir, `frame_${m}${s}_${ms}.jpg`);
                        fs.writeFileSync(fullPath, buffer);
                        newFrame.filePath = fullPath;
                    } catch (err) { console.error("Auto-save failed:", err); }
                }
                if (append) {
                    setFrames(prev => [...prev, newFrame]);
                }
                resolve(newFrame);
            }, 'image/jpeg', 0.95);
        });
    };

    const handleSelectFrames = async () => {
        if (!videoRefVal || isExtracting) return;
        setIsExtracting(true);
        setExtractElapsed(0);
        setExtractStatus('准备中...');
        const extractStartTime = Date.now();
        extractTimerRef.current = setInterval(() => {
            setExtractElapsed(Math.round((Date.now() - extractStartTime) / 1000));
        }, 500);

        const effectiveStart = Math.max(0, rangeStart);
        const effectiveEnd = Math.min(duration, (rangeEnd > 0) ? rangeEnd : duration);
        const activeDuration = effectiveEnd - effectiveStart;

        if (activeDuration <= 0.5) {
            if (extractTimerRef.current) { clearInterval(extractTimerRef.current); extractTimerRef.current = null; }
            setIsExtracting(false);
            return;
        }

        const segmentDuration = activeDuration / targetCount;
        const sampleFps = Math.min(12, Math.max(2, targetCount / Math.max(activeDuration, 1) * 4));
        const DHASH_THRESHOLD = fps > 40 ? 25 : 20;

        const { ipcRenderer } = window.require('electron');
        const fsNode = window.require('fs');
        const pathNode = window.require('path');
        const osNode = window.require('os');
        const tempDir = pathNode.join(osNode.tmpdir(), `vme_extract_${Date.now()}`);

        try {
            const videoPath = videoFile.loadedPath || videoFile.path;
            if (!videoPath) throw new Error('No video file path available');

            setExtractStatus('FFmpeg 候选筛帧中...');
            const framePaths = await ipcRenderer.invoke('extract-frames-smart', {
                filePath: videoPath,
                startTime: effectiveStart,
                duration: activeDuration,
                fps: sampleFps,
                outputDir: tempDir
            });

            if (!framePaths || framePaths.length === 0) {
                throw new Error('FFmpeg extracted 0 frames');
            }

            // ====== 分段优选 + 跨段 dHash 去重 ======
            setExtractStatus('分析优选中...');
            const sampleInterval = activeDuration / framePaths.length;
            const candidates = [];
            for (let i = 0; i < framePaths.length; i++) {
                const timeToCapture = effectiveStart + i * sampleInterval;
                if (timeToCapture > effectiveEnd) break;
                setExtractStatus(`分析帧 ${i + 1}/${framePaths.length}`);
                const img = await loadImageFromPath(framePaths[i]);
                const analysisCanvas = cropFrameToCanvas(img, 0, false);
                const outputCanvas = portraitRatio ? cropFrameToCanvas(img, cropOffset, true, portraitRatio) : analysisCanvas;
                const sharpness = computeSharpness(analysisCanvas);
                const hash = computeDHash(analysisCanvas);
                const content = analyzeFrameContent(analysisCanvas);
                if (!content.isUsable) continue;
                candidates.push({
                    time: timeToCapture,
                    canvas: outputCanvas,
                    sharpness,
                    offset: portraitRatio ? cropOffset : 0,
                    hash,
                    ...content,
                    selectionScore: computeSelectionScore({ sharpness, ...content })
                });
            }

            const finalFrames = [];
            let lastHash = null;
            const sharpnessFloor = getSharpnessFloor(candidates.map(item => item.sharpness));
            for (let seg = 0; seg < targetCount; seg++) {
                const segStart = effectiveStart + seg * segmentDuration;
                const segEnd = segStart + segmentDuration;
                const segFrames = candidates.filter(c => c.time >= segStart && c.time < segEnd);
                if (segFrames.length === 0) continue;
                const clearFrames = segFrames.filter(frame => frame.sharpness >= sharpnessFloor);
                if (clearFrames.length === 0) continue;
                const rankedFrames = rankFramesForSelection(clearFrames);
                const picked = pickDiverseFrame(rankedFrames, lastHash);
                if (picked) {
                    finalFrames.push(picked);
                    lastHash = picked.hash;
                }
            }

            // ====== 输出 ======
            setExtractStatus('保存优选帧...');
            finalFrames.sort((a, b) => a.time - b.time);
            revokeFrames(frames);
            const nextFrames = [];
            for (const frame of finalFrames) {
                const savedFrame = await saveCanvasAsFrame(frame.canvas, frame.time, {
                    isPortrait: !!portraitRatio,
                    ratio: portraitRatio || '原图',
                    append: false
                });
                if (savedFrame) nextFrames.push(savedFrame);
            }
            setFrames(nextFrames);
            showCaptureNotice(nextFrames.length > 0 ? `已优选 ${nextFrames.length} 张` : '未选出可用帧');

        } catch (err) {
            console.error('FFmpeg extraction failed:', err);
        } finally {
            try {
                if (fsNode.existsSync(tempDir)) {
                    fsNode.rmSync(tempDir, { recursive: true, force: true });
                }
            } catch (cleanupErr) {
                console.error('Temp directory cleanup failed:', cleanupErr);
            }
        }

        if (extractTimerRef.current) { clearInterval(extractTimerRef.current); extractTimerRef.current = null; }
        setExtractElapsed(Math.round((Date.now() - extractStartTime) / 1000));
        setExtractStatus('');
        setIsExtracting(false);

        // ====== 内部辅助：从候选帧中返回按清晰度排序的列表（含 hash） ======
        function rankFramesForSelection(items) {
            return [...items].sort((a, b) => {
                if (a.isUsable !== b.isUsable) return a.isUsable ? -1 : 1;
                return (b.selectionScore ?? 0) - (a.selectionScore ?? 0);
            });
        }

        // ====== 内部辅助：跨段去重选帧 ======
        // 优先选最清晰帧，但如果与前一已选帧太相似（Hamming < 阈值），则取次优
        function pickDiverseFrame(ranked, prevHash) {
            if (!ranked || ranked.length === 0) return null;
            if (!prevHash) return ranked[0]; // 第一段直接取最清晰

            for (const candidate of ranked) {
                if (hashDistance(candidate.hash, prevHash) >= DHASH_THRESHOLD) {
                    return candidate; // 找到一个足够不同的帧
                }
            }
            // 所有候选都与前帧相似，仍取最清晰的（总比跳过好）
            return ranked[0];
        }
    };

    const handlePortraitProcess = async (options = {}) => {
        const {
            frameIds = null,
            ratio = portraitRatio,
            offset = cropOffset
        } = options;

        if (isExtracting || frames.length === 0 || !ratio) return;
        const targetFrames = frames.filter(frame => !frame.isPortrait && (!frameIds || frameIds.includes(frame.id)));
        if (targetFrames.length === 0) return;

        setIsExtracting(true);
        setExtractElapsed(0);
        setExtractStatus('竖图处理中...');
        const processStartTime = Date.now();
        extractTimerRef.current = setInterval(() => {
            setExtractElapsed(Math.round((Date.now() - processStartTime) / 1000));
        }, 500);

        try {
            const processedFrames = new Map();
            for (let i = 0; i < targetFrames.length; i++) {
                setExtractStatus(`竖图处理 ${i + 1}/${targetFrames.length}`);
                const frame = targetFrames[i];
                const img = await loadImageFromUrl(frame.url);
                const canvas = cropFrameToCanvas(img, offset, true, ratio);
                const savedFrame = await saveCanvasAsFrame(canvas, frame.time, {
                    isPortrait: true,
                    ratio,
                    append: false,
                    sourceFrameId: frame.id
                });
                if (savedFrame) {
                    savedFrame.sourceFrame = { ...frame };
                }
                if (savedFrame) processedFrames.set(frame.id, savedFrame);
            }

            setFrames(prev => prev.map(frame => processedFrames.get(frame.id) ?? frame));
            showCaptureNotice(processedFrames.size > 0 ? `已处理 ${processedFrames.size} 张竖图` : '未生成竖图');
        } finally {
            if (extractTimerRef.current) { clearInterval(extractTimerRef.current); extractTimerRef.current = null; }
            setExtractElapsed(Math.round((Date.now() - processStartTime) / 1000));
            setExtractStatus('');
            setIsExtracting(false);
        }
    };

    function cropFrameToCanvas(img, frameOffset, usePortraitCrop, ratio = portraitRatio) {
        const vWidth = img.naturalWidth || img.width;
        const vHeight = img.naturalHeight || img.height;
        let sx = 0, sy = 0, sWidth = vWidth, sHeight = vHeight;

        if (usePortraitCrop && ratio) {
            const ratioParts = ratio.split(':');
            const targetAspect = parseInt(ratioParts[0]) / parseInt(ratioParts[1]);
            const targetWidth = vHeight * targetAspect;
            if (targetWidth <= vWidth) {
                sWidth = targetWidth;
                const maxOff = (vWidth - sWidth) / 2;
                sx = (vWidth - sWidth) / 2 + frameOffset * maxOff;
            } else {
                sHeight = vWidth / targetAspect;
                sy = (vHeight - sHeight) / 2;
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = sWidth;
        canvas.height = sHeight;
        canvas.getContext('2d').drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
        return canvas;
    }

    // 使用 stateRef 持久化最新状态，彻底避免 React 渲染销毁事件监听引起的“长按断触”问题
    const stateRef = useRef({ videoRefVal, duration, fps, seekStep, togglePlay, captureFrame, handleSetStart, handleSetEnd, handleSeek });
    useEffect(() => {
        stateRef.current = { videoRefVal, duration, fps, seekStep, togglePlay, captureFrame, handleSetStart, handleSetEnd, handleSeek };
    });

    useEffect(() => {
        // ====== 固定节拍 Seek：匀速 + 帧就绪门控 ======
        // 固定间隔定时器保证匀速，seekReady 标志位保证只有前一帧解码完才跳下一帧
        let seekActive = false;
        let seekDirection = 0;
        let seekIntervalId = null;
        let seekReady = true; // 门控：上一帧是否已解码完毕

        const processSeekTick = () => {
            if (!seekActive || !seekReady) return; // 帧未就绪则跳过本次 tick
            const { videoRefVal, duration, fps, seekStep, handleSeek } = stateRef.current;
            if (!videoRefVal) { seekActive = false; return; }

            let newTime = videoRefVal.currentTime + seekDirection * seekStep * (1 / fps);
            newTime = Math.max(0, Math.min(duration, newTime));

            // 到达边界就停止
            if ((seekDirection > 0 && newTime >= duration) || (seekDirection < 0 && newTime <= 0)) {
                handleSeek(newTime);
                stopSeek();
                return;
            }

            seekReady = false; // 锁定，等帧渲染完
            handleSeek(newTime);

            // 纯 seeked 事件门控：帧解码完毕自动放行，不强制超时解锁
            videoRefVal.addEventListener('seeked', () => { seekReady = true; }, { once: true });
        };

        const startSeek = (direction) => {
            if (seekActive) return;
            seekActive = true;
            seekDirection = direction;
            seekReady = true;
            processSeekTick(); // 立即第一跳
            // 固定 100ms 间隔 = 匀速 10 次/秒
            seekIntervalId = setInterval(processSeekTick, 100);
        };

        const stopSeek = () => {
            seekActive = false;
            seekDirection = 0;
            seekReady = true;
            if (seekIntervalId) {
                clearInterval(seekIntervalId);
                seekIntervalId = null;
            }
        };

        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT') return;
            const { togglePlay, captureFrame, handleSetStart, handleSetEnd } = stateRef.current;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    if (e.repeat) return; // ignore hold space
                    togglePlay();
                    break;
                case 'KeyS':
                    e.preventDefault();
                    if (e.repeat) return; // ignore hold S
                    captureFrame();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    if (!e.repeat) startSeek(-1);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    if (!e.repeat) startSeek(1);
                    break;
                case 'KeyI': handleSetStart(); break;
                case 'KeyO': handleSetEnd(); break;
            }
        };

        const handleKeyUp = (e) => {
            if (e.target.tagName === 'INPUT') return;
            if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
                stopSeek();
            }
        };

        const handleMouseDown = (e) => {
            if (e.target.tagName === 'INPUT') return;
            if (e.button === 3 || e.button === 4) {
                e.preventDefault();
                e.stopPropagation();
                startSeek(e.button === 3 ? 1 : -1);
            }
        };

        const handleMouseUpExtra = (e) => {
            if (e.button === 3 || e.button === 4) {
                e.preventDefault();
                e.stopPropagation();
                stopSeek();
            }
        };

        const handleAuxClick = (e) => {
            if (e.button === 3 || e.button === 4) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('keyup', handleKeyUp, true);
        window.addEventListener('mousedown', handleMouseDown, true);
        window.addEventListener('mouseup', handleMouseUpExtra, true);
        window.addEventListener('auxclick', handleAuxClick, true);
        window.addEventListener('blur', stopSeek);

        return () => {
            stopSeek();
            window.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('keyup', handleKeyUp, true);
            window.removeEventListener('mousedown', handleMouseDown, true);
            window.removeEventListener('mouseup', handleMouseUpExtra, true);
            window.removeEventListener('auxclick', handleAuxClick, true);
            window.removeEventListener('blur', stopSeek);
        };
    }, []); // <-- 依赖数组为空！初始化执行一次，靠 stateRef 穿透状态

    return (
        <div className="flex h-screen w-screen bg-black overflow-hidden font-sans text-sm select-none">

            {isVideoLoading && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-4 text-white">
                        <Loader2 className="animate-spin text-indigo-500" size={48} />
                        <div className="font-bold tracking-widest text-lg">FFmpeg 底层媒体引擎处理中...</div>
                        <div className="text-zinc-400 text-sm">正在修复视频封装与编码兼容性</div>
                    </div>
                </div>
            )}

            {captureNotice && !isVideoLoading && !isExtracting && (
                <div className="absolute top-6 left-1/2 z-50 -translate-x-1/2 pointer-events-none">
                    <div className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-bold text-emerald-200 shadow-[0_8px_30px_rgba(16,185,129,0.18)] backdrop-blur-md">
                        {captureNotice}
                    </div>
                </div>
            )}

            {isExtracting && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-5 text-white">
                        <div className="relative">
                            <Loader2 className="animate-spin text-indigo-500" size={56} />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-xs font-mono font-bold text-indigo-300">{extractElapsed}s</span>
                            </div>
                        </div>
                        <div className="font-bold tracking-widest text-lg">{extractStatus || '提取中...'}</div>
                        <div className="text-zinc-500 text-xs">提取完成前请勿操作</div>
                    </div>
                </div>
            )}

            {/* Zone A: The Stage */}
            <div className={`relative flex-1 flex flex-col items-center justify-center bg-black group w-full h-full transition-[padding] duration-300 ${isVerticalContent ? 'pb-40' : ''}`}>
                <VideoStage
                    videoFile={videoFile}
                    onFileLoaded={handleFileLoaded}
                    setVideoRef={setVideoRefVal}
                    onTimeUpdate={onTimeUpdate}
                    onDurationChange={onDurationChange}
                    onEnded={onEnded}
                    onCapture={captureFrame} // <--- 传递截图函数
                    portraitRatio={portraitRatio} // <--- 传递竖图状态给 Stage 显示遮罩
                    cropOffset={cropOffset}    // <--- Pass State
                    onCropMove={handleManualCropMove} // <--- 绑定到含有智能锁定接管逻辑的句柄上
                />

                {/* Zone B: The Cockpit */}
                {videoFile && (
                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 transform">
                        <FloatingCockpit
                            seekStep={seekStep}
                            onSeekStepChange={setSeekStep}
                            isPlaying={isPlaying}
                            onTogglePlay={togglePlay}
                            currentTime={currentTime}
                            duration={duration}
                            onSeek={handleSeek}

                            // Range Props
                            rangeStart={rangeStart}
                            rangeEnd={rangeEnd}
                            onUpdateStart={(val) => {
                                setRangeStart(val);
                                updateCountFromMultiplier(multiplier, val, rangeEnd);
                            }}
                            onUpdateEnd={(val) => {
                                setRangeEnd(val);
                                updateCountFromMultiplier(multiplier, rangeStart, val);
                            }}
                            onResetRange={handleResetRange}

                            portraitRatio={portraitRatio}
                            onSetPortraitMode={setPortraitMode}

                            // Extract Props
                            targetCount={targetCount}
                            onTargetCountChange={handleTargetCountChange}
                            multiplier={multiplier}
                            onMultiplierChange={handleMultiplierChange}
                            isExtracting={isExtracting}
                            extractElapsed={extractElapsed}
                            extractStatus={extractStatus}
                            onSelectFrames={handleSelectFrames}
                        />
                    </div>
                )}
            </div>

            {/* Zone C: The Archives */}
            <Sidebar
                frames={frames}
                onClear={handleClear}
                onDeleteFrame={handleDeleteFrame}
                onRestoreFrame={handleRestoreFrame}
                onPortraitProcess={handlePortraitProcess}
                onDownload={handleDownload}
                cacheDir={cacheDir}
                onSelectCacheDir={handleSelectCache}
            />

        </div>
    );
}

// Sub-components
function FloatingCockpit({
    seekStep, onSeekStepChange,
    isPlaying, onTogglePlay,
    currentTime, duration, onSeek,
    rangeStart, rangeEnd, onUpdateStart, onUpdateEnd, onResetRange,
    portraitRatio, onSetPortraitMode,
    targetCount, onTargetCountChange,
    multiplier, onMultiplierChange,
    isExtracting, extractElapsed, extractStatus, onSelectFrames
}) {
    // Local State for Range Mode Toggle
    // We lift this up if App needs to know, but for UI visibility, local is fine.
    // However, extraction logic needs to know if we are using range or full.
    // Local State
    const [isRangeMode, setIsRangeMode] = useState(false);

    // Refs & Drag State
    const progressBarRef = useRef(null);
    const [isDraggingSeek, setIsDraggingSeek] = useState(false);
    const [draggingHandle, setDraggingHandle] = useState(null);

    // Helper: Calculate Time from MouseX
    const calculateTime = (e) => {
        if (!progressBarRef.current || !duration) return 0;
        const rect = progressBarRef.current.getBoundingClientRect();
        // Use logic to clamp within [0, rect.width]
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        return (x / rect.width) * duration;
    };

    // --- Interaction Handlers ---

    // 1. Seek / Scrubber
    const handleSeekMouseDown = (e) => {
        // Prevent conflict if clicking handles
        if (e.target.closest('.range-handle')) return;

        setIsDraggingSeek(true);
        const t = calculateTime(e);
        onSeek(t); // Jump immediately

        const move = (ev) => onSeek(calculateTime(ev));
        const up = () => {
            setIsDraggingSeek(false);
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    // 2. Range Handles
    const handleHandleMouseDown = (e, type) => {
        e.stopPropagation();
        setDraggingHandle(type);

        const move = (ev) => {
            const t = calculateTime(ev);
            if (type === 'start') {
                const max = (rangeEnd > 0 ? rangeEnd : duration) - 0.5;
                const val = Math.max(0, Math.min(t, max));
                onUpdateStart(val);
                onSeek(val); // Sync video frame
            } else {
                const min = rangeStart + 0.5;
                const val = Math.max(min, Math.min(t, duration));
                onUpdateEnd(val);
                onSeek(val); // Sync video frame
            }
        };

        const up = () => {
            setDraggingHandle(null);
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };

        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    // 3. Toggle Logic
    const toggleRangeMode = () => {
        const newMode = !isRangeMode;
        setIsRangeMode(newMode);
        if (!newMode) onResetRange(); // Reset when closing
    };

    // --- Render Helpers ---
    const progressPct = duration ? (currentTime / duration) * 100 : 0;
    const effectiveEnd = (rangeEnd > 0) ? rangeEnd : duration;

    // Viz Percentages
    const rStartPct = duration ? (rangeStart / duration) * 100 : 0;
    const rEndPct = duration ? (effectiveEnd / duration) * 100 : 100;
    const rWidthPct = rEndPct - rStartPct;

    const extractDuration = isRangeMode ? (effectiveEnd - rangeStart) : duration;

    // Common Button Styles
    const btnBase = "h-9 flex items-center justify-center rounded-xl transition-all border outline-none select-none";
    const btnGlass = `${btnBase} bg-white/5 border-white/5 text-zinc-400 hover:text-white hover:bg-white/10 active:scale-95`;
    const btnActive = `${btnBase} bg-indigo-500/20 border-indigo-500/50 text-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.2)]`;


    return (
        <div className="flex flex-col gap-4 min-w-[760px] p-5 rounded-[24px] bg-[#121214]/90 backdrop-blur-2xl border border-white/10 shadow-2xl ring-1 ring-black/40 hover:-translate-y-1 transition-all duration-300">

            {/* 1. Progress Section */}
            <div className={`flex items-center gap-4 w-full px-1 relative ${isRangeMode ? 'pt-3' : ''} transition-all duration-300`}>
                <span className="font-mono text-xs text-zinc-500 min-w-[44px] text-right font-medium">{formatTime(currentTime)}</span>

                {/* Track Container */}
                <div
                    ref={progressBarRef}
                    className="flex-1 h-2 relative group cursor-pointer touch-none"
                    style={{ marginTop: isRangeMode ? '4px' : '0', marginBottom: isRangeMode ? '4px' : '0' }}
                    onMouseDown={handleSeekMouseDown}
                >
                    {/* Track Background */}
                    <div className="absolute top-0 bottom-0 left-0 right-0 bg-white/10 rounded-full overflow-hidden">
                        {/* Progress Fill (White) - Now underneath Range */}
                        <div
                            className="absolute top-0 bottom-0 left-0 bg-white/30"
                            style={{ width: `${progressPct}%` }}
                        ></div>

                        {/* Buffered/Range Zone (Blue) - On Top & Opaque for Consistent Color */}
                        <div
                            className={`absolute top-0 bottom-0 bg-indigo-500 transition-opacity duration-300 ${isRangeMode ? 'opacity-100' : 'opacity-0'}`}
                            style={{ left: `${rStartPct}%`, width: `${rWidthPct}%` }}
                        ></div>
                    </div>

                    {/* Playhead (The "Hanging Pendant") - Refined & Textured */}
                    <div
                        className="absolute top-0 h-full z-40 cursor-grab active:cursor-grabbing transition-none will-change-left"
                        style={{ left: `${progressPct}%`, transform: 'translateX(-50%)' }}
                        onMouseDown={(e) => { e.stopPropagation(); handleSeekMouseDown(e); }}
                    >
                        {/* 1. Vertical Indicator Line (Glows on drag) */}
                        <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-[2px] bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.6)] transition-all duration-200 ${isDraggingSeek ? 'h-6 shadow-[0_0_12px_rgba(255,255,255,0.9)] bg-indigo-100' : 'h-5'
                            }`}></div>

                        {/* 2. The Textured Knob (Hanging Below) */}
                        <div className={`absolute top-2.5 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center transition-transform duration-200 ${isDraggingSeek ? 'scale-110' : 'group-hover:scale-105'
                            }`}>
                            {/* Main Body */}
                            <div className="w-3.5 h-4 bg-gradient-to-b from-zinc-100 to-zinc-400 rounded-b-md rounded-t-sm shadow-[0_4px_8px_rgba(0,0,0,0.4),inset_0_1px_1px_rgba(255,255,255,0.8)] border-[0.5px] border-white/60 flex flex-col items-center justify-center gap-[2px]">
                                {/* Texture Grips */}
                                <div className="w-2 h-[1px] bg-black/30 shadow-[0_1px_0_rgba(255,255,255,0.2)]"></div>
                                <div className="w-2 h-[1px] bg-black/30 shadow-[0_1px_0_rgba(255,255,255,0.2)]"></div>
                            </div>

                            {/* Tiny Triangle Pointer on Top (Optical connection) */}
                            <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[3px] border-b-zinc-100 absolute -top-[2px]"></div>
                        </div>
                    </div>

                    {/* Range Handles (Only in Range Mode) */}
                    {isRangeMode && (
                        <>
                            {/* Start Handle */}
                            <div
                                className={`range-handle absolute -top-3 w-4 -ml-2 h-8 cursor-ew-resize z-30 flex flex-col items-center justify-start group/handle`}
                                style={{ left: `${rStartPct}%` }}
                                onMouseDown={(e) => handleHandleMouseDown(e, 'start')}
                            >
                                <div className={`w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-indigo-400 drop-shadow-lg transition-all group-hover/handle:border-t-white ${draggingHandle === 'start' ? 'border-t-white scale-125' : ''}`}></div>
                                <div className={`w-px h-3 bg-indigo-400/50 group-hover/handle:bg-white/50 ${draggingHandle === 'start' ? 'bg-white' : ''}`}></div>
                                {/* Tooltip */}
                                <div className="absolute -top-7 px-1.5 py-0.5 rounded bg-zinc-800 border border-white/10 text-[10px] font-mono text-zinc-300 opacity-0 group-hover/handle:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                    {formatTime(rangeStart)}
                                </div>
                            </div>

                            {/* End Handle */}
                            <div
                                className={`range-handle absolute -top-3 w-4 -ml-2 h-8 cursor-ew-resize z-30 flex flex-col items-center justify-start group/handle`}
                                style={{ left: `${rEndPct}%` }}
                                onMouseDown={(e) => handleHandleMouseDown(e, 'end')}
                            >
                                <div className={`w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-indigo-400 drop-shadow-lg transition-all group-hover/handle:border-t-white ${draggingHandle === 'end' ? 'border-t-white scale-125' : ''}`}></div>
                                <div className={`w-px h-3 bg-indigo-400/50 group-hover/handle:bg-white/50 ${draggingHandle === 'end' ? 'bg-white' : ''}`}></div>
                                {/* Tooltip */}
                                <div className="absolute -top-7 px-1.5 py-0.5 rounded bg-zinc-800 border border-white/10 text-[10px] font-mono text-zinc-300 opacity-0 group-hover/handle:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                    {formatTime(effectiveEnd)}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <span className="font-mono text-xs text-zinc-500 min-w-[44px] font-medium">{formatTime(duration)}</span>
            </div>

            {/* 2. Control Bar */}
            <div className="flex items-center gap-3 rounded-[20px] bg-[#0a0a0b]/78 border border-white/8 shadow-[0_16px_40px_rgba(0,0,0,0.35)] ring-1 ring-white/5 px-4 py-3">

                {/* Left: Transport Controls */}
                <div className="flex items-center gap-2 shrink-0">
                    <button onClick={onTogglePlay} className={`${btnGlass} w-11 h-11 shrink-0`} title={isPlaying ? "暂停 Space" : "播放 Space"}>
                        {isPlaying ? <Pause size={18} className="fill-current" /> : <Play size={18} className="fill-current ml-0.5" />}
                    </button>

                    <div className="h-11 px-3 flex items-center gap-2 rounded-xl bg-white/5 border border-white/5 text-xs text-zinc-400 group focus-within:border-white/20 transition-colors shrink-0">
                        <FastForward size={14} />
                        <span className="text-[10px] font-bold whitespace-nowrap">步进</span>
                        <input
                            type="number"
                            className="w-8 bg-transparent text-center font-mono font-bold focus:outline-none text-zinc-200"
                            value={seekStep}
                            onChange={(e) => onSeekStepChange(Number(e.target.value))}
                        />
                        <span className="text-[10px] whitespace-nowrap">帧</span>
                    </div>
                </div>

                <div className="flex-1"></div>

                {/* Middle: Manual Crop */}
                <div className="flex items-center justify-center gap-2 shrink-0">
                    <button
                        onClick={toggleRangeMode}
                        className={`h-11 px-5 rounded-xl flex items-center gap-2 text-xs font-bold transition-all border whitespace-nowrap ${isRangeMode ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-white/5 border-white/5 text-zinc-500 hover:text-zinc-300 hover:bg-white/10'}`}
                    >
                        <ScanLine size={16} />
                        <span>区间</span>
                    </button>

                    <div className="flex items-center gap-1 rounded-xl bg-black/35 border border-white/10 p-1 shadow-inner ring-1 ring-white/5">
                        {['9:16', '3:4', '4:5'].map(ratio => (
                            <button
                                key={ratio}
                                onClick={() => onSetPortraitMode(ratio)}
                                className={`h-9 px-3 rounded-lg flex items-center justify-center text-xs font-bold font-mono transition-all whitespace-nowrap ${portraitRatio === ratio
                                    ? 'bg-purple-500/30 text-purple-200 ring-1 ring-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.18)]'
                                    : 'bg-transparent text-zinc-500 hover:text-zinc-200 hover:bg-white/8'
                                    }`}
                            >
                                {ratio}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1"></div>

                {/* Right: Select Panel */}
                <div className="flex items-center h-11 px-2 rounded-xl bg-black/35 border border-white/10 shadow-inner ring-1 ring-white/5 shrink-0">
                    <div className="flex flex-col items-center justify-center w-[50px] px-1">
                        <span className="text-[9px] text-zinc-500 font-medium leading-none mb-1">≤上限</span>
                        <input
                            type="number"
                            value={targetCount}
                            onChange={(e) => onTargetCountChange(e.target.value === '' ? '' : parseInt(e.target.value))}
                            onBlur={() => { if (!targetCount) onTargetCountChange(1); }}
                            className="w-full bg-transparent text-center font-mono text-base font-bold text-zinc-200 focus:text-white focus:outline-none border-none p-0 leading-none"
                        />
                    </div>

                    <div className="w-px h-6 bg-white/6 mx-1"></div>

                    <button
                        onClick={onSelectFrames}
                        disabled={isExtracting}
                        className={`group relative h-9 min-w-[96px] px-4 rounded-lg font-bold transition-all duration-300 flex items-center justify-center gap-2 overflow-hidden ring-1 ring-inset ${isExtracting
                            ? 'bg-zinc-800 text-zinc-500 ring-white/5 cursor-not-allowed'
                            : 'bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-[0_2px_10px_rgba(79,70,229,0.3),inset_0_1px_1px_rgba(255,255,255,0.3)] ring-white/10 hover:shadow-[0_4px_15px_rgba(79,70,229,0.4),inset_0_1px_1px_rgba(255,255,255,0.4)] hover:scale-[1.02] active:scale-[0.98]'
                            }`}
                    >
                        {!isExtracting && <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/10 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>}
                        {isExtracting ? <Loader2 size={14} className="animate-spin" /> : <><Zap size={13} className="fill-current drop-shadow-sm" /><span className="text-xs tracking-wide drop-shadow-sm">优选</span></>}
                    </button>

                    <div className="w-px h-6 bg-white/6 mx-1"></div>

                    <div className={`w-[42px] text-center text-[10px] font-mono font-bold leading-none transition-colors ${isExtracting ? 'text-amber-400 animate-pulse' : extractElapsed > 0 ? 'text-emerald-400' : 'text-indigo-300'}`}>
                        {isExtracting ? `${extractElapsed}s` : extractElapsed > 0 ? `${extractElapsed}s` : `${Math.floor(extractDuration)}s`}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default App;
