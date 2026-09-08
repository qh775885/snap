import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Trash2, FolderOpen, ExternalLink, CheckSquare, Square, X, ChevronLeft, ChevronRight, LayoutGrid, Columns } from 'lucide-react';
import { openPath } from '../bridge';

export function Gallery({
    snapshots = [],           // [{ id, filePath, fileName, base64, width, height, timestamp }]
    onDeleteSnapshot,         // (id, filePath) => void
    onBatchDeleteSnapshots,    // (ids) => void
    outputDir,
    onSelectOutputDir,
}) {
    const [selectedId, setSelectedId] = useState(null);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
    const [columnsMode, setColumnsMode] = useState(2); // 1: 单列大图, 2: 双列网格 (默认双列)

    // 看图器模式：当前查看的索引 (-1 为关闭)
    const [lightboxIndex, setLightboxIndex] = useState(-1);

    const listContainerRef = useRef(null);
    const prevSnapshotsCountRef = useRef(snapshots.length);

    // 当有新截图加入时，自动选中最新的一张并平滑滚动到最顶部
    useEffect(() => {
        if (snapshots.length > prevSnapshotsCountRef.current) {
            // 有新照片加入
            if (snapshots.length > 0) {
                setSelectedId(snapshots[0].id);
            }
            if (listContainerRef.current) {
                listContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }
        prevSnapshotsCountRef.current = snapshots.length;
    }, [snapshots]);

    // 默认选中第一张
    useEffect(() => {
        if (snapshots.length > 0 && !selectedId) {
            setSelectedId(snapshots[0].id);
        }
    }, [snapshots, selectedId]);

    // ===== 单张删除逻辑 =====
    const handleDeleteSingle = useCallback((id, filePath) => {
        const currIndex = snapshots.findIndex(s => s.id === id);

        if (onDeleteSnapshot) {
            onDeleteSnapshot(id, filePath);
        }

        setSelectedIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });

        // 焦点顺移：如果删除后还有其他图片，顺移到下一张
        if (snapshots.length > 1) {
            const nextIndex = currIndex < snapshots.length - 1 ? currIndex : currIndex - 1;
            const nextItem = snapshots[nextIndex === currIndex ? nextIndex + 1 : nextIndex];
            if (nextItem) {
                setSelectedId(nextItem.id);
            }
            // 若看图器正在打开，同步切换到新的当前索引
            if (lightboxIndex !== -1) {
                const newLightboxIdx = Math.min(currIndex, snapshots.length - 2);
                setLightboxIndex(newLightboxIdx);
            }
        } else {
            setSelectedId(null);
            setLightboxIndex(-1);
        }
    }, [onDeleteSnapshot, snapshots, lightboxIndex]);

    // 批量删除
    const handleBatchDelete = () => {
        if (selectedIds.size === 0) return;
        if (onBatchDeleteSnapshots) {
            onBatchDeleteSnapshots(Array.from(selectedIds));
        }
        setSelectedIds(new Set());
        setSelectedId(null);
        if (lightboxIndex !== -1) setLightboxIndex(-1);
    };

    // 看图器中的上一张/下一张
    const handleLightboxPrev = useCallback(() => {
        if (snapshots.length === 0) return;
        setLightboxIndex(prev => (prev > 0 ? prev - 1 : snapshots.length - 1));
    }, [snapshots.length]);

    const handleLightboxNext = useCallback(() => {
        if (snapshots.length === 0) return;
        setLightboxIndex(prev => (prev < snapshots.length - 1 ? prev + 1 : 0));
    }, [snapshots.length]);

    // 全局键盘事件监听（支持普通列表与全屏看图器的 Del 秒删和方向键快速选图）
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // 看图器模式下的快捷键
            if (lightboxIndex >= 0 && lightboxIndex < snapshots.length) {
                const currentItem = snapshots[lightboxIndex];
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    handleLightboxPrev();
                } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    handleLightboxNext();
                } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    if (currentItem) {
                        handleDeleteSingle(currentItem.id, currentItem.filePath);
                    }
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setLightboxIndex(-1);
                }
                return;
            }

            // 普通图库列表模式下的快捷键
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedIds.size > 0) {
                    e.preventDefault();
                    handleBatchDelete();
                } else if (selectedId) {
                    const item = snapshots.find(s => s.id === selectedId);
                    if (item) {
                        e.preventDefault();
                        handleDeleteSingle(item.id, item.filePath);
                    }
                }
            } else if (e.key === 'Enter') {
                // 回车键进入看图器
                if (selectedId) {
                    const idx = snapshots.findIndex(s => s.id === selectedId);
                    if (idx !== -1) {
                        e.preventDefault();
                        setLightboxIndex(idx);
                    }
                }
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                e.preventDefault();
                const currIdx = snapshots.findIndex(s => s.id === selectedId);
                if (currIdx !== -1 && currIdx < snapshots.length - 1) {
                    setSelectedId(snapshots[currIdx + 1].id);
                }
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const currIdx = snapshots.findIndex(s => s.id === selectedId);
                if (currIdx > 0) {
                    setSelectedId(snapshots[currIdx - 1].id);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedId, selectedIds, snapshots, lightboxIndex, handleDeleteSingle, handleLightboxPrev, handleLightboxNext]);

    const currentLightboxItem = (lightboxIndex >= 0 && lightboxIndex < snapshots.length) ? snapshots[lightboxIndex] : null;

    // 切换多选状态
    const toggleSelect = (id, e) => {
        e.stopPropagation();
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    return (
        <aside className="w-96 h-full bg-[#11141a] border-l border-slate-800 flex flex-col select-none text-slate-200">
            {/* 顶部标题与目录信息栏 */}
            <div className="p-3 border-b border-slate-800/90 flex flex-col gap-2 bg-[#141820]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm tracking-wide text-white">靶场图库</span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            {snapshots.length} 张
                        </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                        {/* 单双列切换按钮 */}
                        <button
                            onClick={() => setColumnsMode(prev => prev === 1 ? 2 : 1)}
                            className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                            title={columnsMode === 1 ? "切换为双列排布" : "切换为单列大图"}
                        >
                            {columnsMode === 1 ? <LayoutGrid className="w-3.5 h-3.5" /> : <Columns className="w-3.5 h-3.5" />}
                        </button>

                        {/* 多选模式切换 */}
                        <button
                            onClick={() => setIsMultiSelectMode(!isMultiSelectMode)}
                            className={`px-2 py-1 rounded text-xs transition ${
                                isMultiSelectMode
                                    ? 'bg-emerald-500 text-slate-950 font-bold'
                                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                            }`}
                            title="多选清理"
                        >
                            多选
                        </button>

                        {/* 打开目录 */}
                        <button
                            onClick={() => outputDir && openPath(outputDir)}
                            className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                            title="在资源管理器中打开输出目录"
                        >
                            <FolderOpen className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* 存储路径与更换 */}
                <div className="flex items-center justify-between text-[11px] text-slate-400 gap-2">
                    <span className="truncate" title={outputDir || '未指定输出目录'}>
                        {outputDir ? outputDir.split(/[\\/]/).slice(-2).join('/') : '默认保存在视频同级/快门截图'}
                    </span>
                    <button
                        onClick={onSelectOutputDir}
                        className="text-emerald-400 hover:underline shrink-0 font-medium"
                    >
                        更换
                    </button>
                </div>
            </div>

            {/* 多选批量清理工具条 */}
            {isMultiSelectMode && (
                <div className="px-3 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                if (selectedIds.size === snapshots.length) {
                                    setSelectedIds(new Set());
                                } else {
                                    setSelectedIds(new Set(snapshots.map(s => s.id)));
                                }
                            }}
                            className="text-slate-400 hover:text-white flex items-center gap-1"
                        >
                            {selectedIds.size === snapshots.length ? <CheckSquare className="w-3.5 h-3.5 text-emerald-400" /> : <Square className="w-3.5 h-3.5" />}
                            <span>全选</span>
                        </button>
                        <span className="text-slate-400">已选 {selectedIds.size} 张</span>
                    </div>

                    {selectedIds.size > 0 && (
                        <button
                            onClick={handleBatchDelete}
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 font-medium transition"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>删除所选</span>
                        </button>
                    )}
                </div>
            )}

            {/* 截图网格列表（最新截图排在最顶层） */}
            <div
                ref={listContainerRef}
                className={`flex-1 overflow-y-auto p-2.5 custom-scrollbar ${
                    columnsMode === 2 ? 'grid grid-cols-2 gap-2.5 content-start' : 'space-y-2.5'
                }`}
            >
                {snapshots.length === 0 ? (
                    <div className="col-span-2 h-full flex flex-col items-center justify-center text-slate-500 text-xs text-center p-6 gap-2.5">
                        <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                            <span className="text-2xl">📸</span>
                        </div>
                        <p className="font-medium text-slate-300">尚未截取画面</p>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                            取景中点击 <span className="text-emerald-400 font-bold">鼠标右键</span> 或按 <span className="text-emerald-400 font-bold">S</span> 键瞬间截取
                        </p>
                    </div>
                ) : (
                    snapshots.map((item, idx) => {
                        const isSelected = selectedId === item.id;
                        const isChecked = selectedIds.has(item.id);

                        return (
                            <div
                                key={item.id}
                                onClick={() => setSelectedId(item.id)}
                                onDoubleClick={() => setLightboxIndex(idx)}
                                className={`group relative rounded-lg overflow-hidden border transition-all cursor-pointer flex flex-col bg-[#0b0e14] ${
                                    isSelected
                                        ? 'border-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.3)] ring-1 ring-emerald-400'
                                        : 'border-slate-800 hover:border-slate-700'
                                }`}
                            >
                                {/* 完整原比例画面展示容器（彻底杜绝裁切） */}
                                <div
                                    className="relative w-full overflow-hidden bg-black/60 flex items-center justify-center"
                                    style={{
                                        // 保证每张卡片根据自身实际截取尺寸自适应比例，横图宽、竖图长
                                        aspectRatio: item.width && item.height ? `${item.width} / ${item.height}` : '9 / 16',
                                        maxHeight: columnsMode === 1 ? '380px' : '220px',
                                        minHeight: '110px',
                                    }}
                                >
                                    <img
                                        src={item.base64}
                                        alt={item.fileName}
                                        className="w-full h-full object-contain group-hover:scale-[1.02] transition-transform duration-150"
                                        loading="lazy"
                                    />

                                    {/* 多选勾选框 */}
                                    {isMultiSelectMode && (
                                        <button
                                            onClick={(e) => toggleSelect(item.id, e)}
                                            className="absolute top-1.5 left-1.5 p-1 rounded bg-black/70 backdrop-blur-sm z-10"
                                        >
                                            {isChecked ? (
                                                <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                                            ) : (
                                                <Square className="w-3.5 h-3.5 text-slate-400" />
                                            )}
                                        </button>
                                    )}

                                    {/* 悬浮操作图标 */}
                                    <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteSingle(item.id, item.filePath);
                                            }}
                                            className="p-1 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 hover:text-white backdrop-blur-sm"
                                            title="删除此张 (Del 键)"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>

                                    {/* 底部尺寸与序号标签 */}
                                    <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between pointer-events-none text-[9px] font-mono text-slate-300 bg-black/70 px-1.5 py-0.5 rounded backdrop-blur-sm">
                                        <span className="text-emerald-300 font-semibold">#{idx + 1}</span>
                                        <span>{item.width}×{item.height}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* 底部极速操作提示 */}
            <div className="p-2.5 bg-[#0d1017] border-t border-slate-800 text-[11px] text-slate-400 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                    <span className="text-slate-300">💡 双击卡片进入大图看图器</span>
                    <span className="font-mono text-rose-400 font-bold bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">Del 秒删</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span>左右箭头切换，双击看全貌</span>
                    <span>最新截图排在最顶层</span>
                </div>
            </div>

            {/* 沉浸式专业看图器（支持在大图模式下方向键快速切图、Del 键直接秒删废片） */}
            {currentLightboxItem && (
                <div
                    onClick={() => setLightboxIndex(-1)}
                    className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col items-center justify-between p-4 select-none animate-in fade-in duration-100"
                >
                    {/* 顶部控制栏 */}
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full flex items-center justify-between px-4 py-2 bg-slate-900/80 border border-slate-800 rounded-xl z-20 backdrop-blur-md"
                    >
                        <div className="flex items-center gap-3">
                            <span className="font-mono font-bold text-emerald-400 text-sm">
                                第 {lightboxIndex + 1} / {snapshots.length} 张
                            </span>
                            <span className="text-xs font-mono text-slate-400">
                                {currentLightboxItem.width} × {currentLightboxItem.height}
                            </span>
                            <span className="text-xs text-slate-500 truncate max-w-sm" title={currentLightboxItem.fileName}>
                                {currentLightboxItem.fileName}
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* 在系统资源管理器中定位 */}
                            <button
                                onClick={() => openPath(currentLightboxItem.filePath)}
                                className="flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs transition"
                                title="在资源管理器中高亮定位该文件"
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>定位文件</span>
                            </button>

                            {/* 秒删当前大图按钮 */}
                            <button
                                onClick={() => handleDeleteSingle(currentLightboxItem.id, currentLightboxItem.filePath)}
                                className="flex items-center gap-1 px-3 py-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold shadow transition"
                                title="直接删除这张截图 (按键盘 Del 键)"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>删除当前张 (Del)</span>
                            </button>

                            {/* 关闭看图器 */}
                            <button
                                onClick={() => setLightboxIndex(-1)}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition ml-2"
                                title="退出看图器 (Esc)"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* 大图查看工作区 */}
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="relative flex-1 w-full flex items-center justify-center p-4 overflow-hidden"
                    >
                        {/* 上一张按钮 */}
                        <button
                            onClick={handleLightboxPrev}
                            className="absolute left-6 top-1/2 -translate-y-1/2 p-3 rounded-full bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 shadow-2xl transition z-10"
                            title="上一张 (左箭头 / 滚轮向上)"
                        >
                            <ChevronLeft className="w-6 h-6" />
                        </button>

                        {/* 大图画面：保证 100% 完整原比例呈现，不论横屏还是竖屏都不裁切 */}
                        <img
                            src={currentLightboxItem.base64}
                            alt={currentLightboxItem.fileName}
                            className="max-h-[82vh] max-w-[85vw] object-contain rounded-lg shadow-2xl border border-slate-800/80"
                        />

                        {/* 下一张按钮 */}
                        <button
                            onClick={handleLightboxNext}
                            className="absolute right-6 top-1/2 -translate-y-1/2 p-3 rounded-full bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 shadow-2xl transition z-10"
                            title="下一张 (右箭头 / 滚轮向下)"
                        >
                            <ChevronRight className="w-6 h-6" />
                        </button>
                    </div>

                    {/* 底部看图快捷操作提示胶囊 */}
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="px-4 py-1.5 rounded-full bg-slate-900/85 border border-slate-800 text-xs text-slate-400 flex items-center gap-3 backdrop-blur-md"
                    >
                        <span>◀ ▶ 方向键快速翻片</span>
                        <span className="text-slate-700">|</span>
                        <span className="text-rose-400 font-bold">Del 键瞬间淘汰废片并自动切下一张</span>
                        <span className="text-slate-700">|</span>
                        <span>Esc 退出</span>
                    </div>
                </div>
            )}
        </aside>
    );
}
