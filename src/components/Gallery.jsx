import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Trash2, FolderOpen, ExternalLink, CheckSquare, Square, X, ChevronLeft, ChevronRight, LayoutGrid, Columns, Image as ImageIcon } from 'lucide-react';
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
        <aside className="w-80 h-full bg-[#0d0e11] border-l border-white/[0.07] flex flex-col select-none text-zinc-200">
            {/* 顶部标题与目录信息栏 */}
            <div className="p-3 border-b border-white/[0.07] flex flex-col gap-2 bg-[#090a0d]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs tracking-wider text-zinc-200 uppercase font-mono">图库清单</span>
                        <span className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-white/[0.06]">
                            {snapshots.length}
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
                        {/* 单双列切换按钮 */}
                        <button
                            onClick={() => setColumnsMode(prev => prev === 1 ? 2 : 1)}
                            className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-white/[0.06] transition"
                            title={columnsMode === 1 ? "切换为双列排布" : "切换为单列大图"}
                        >
                            {columnsMode === 1 ? <LayoutGrid className="w-3.5 h-3.5" /> : <Columns className="w-3.5 h-3.5" />}
                        </button>

                        {/* 多选模式切换 */}
                        <button
                            onClick={() => setIsMultiSelectMode(!isMultiSelectMode)}
                            className={`px-2 py-1 rounded text-xs transition border ${
                                isMultiSelectMode
                                    ? 'bg-zinc-200 text-zinc-950 font-semibold border-white'
                                    : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border-white/[0.06]'
                            }`}
                            title="多选清理"
                        >
                            多选
                        </button>

                        {/* 打开目录 */}
                        <button
                            onClick={() => outputDir && openPath(outputDir)}
                            className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-white/[0.06] transition"
                            title="在资源管理器中打开输出目录"
                        >
                            <FolderOpen className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* 存储路径与更换 */}
                <div className="flex items-center justify-between text-[11px] text-zinc-500 gap-2 font-mono">
                    <span className="truncate" title={outputDir || '未指定输出目录'}>
                        {outputDir ? outputDir.split(/[\\/]/).slice(-2).join('/') : '默认保存在同级/快门截图'}
                    </span>
                    <button
                        onClick={onSelectOutputDir}
                        className="text-zinc-400 hover:text-zinc-200 underline shrink-0 transition"
                    >
                        更换
                    </button>
                </div>
            </div>

            {/* 多选批量清理工具条 */}
            {isMultiSelectMode && (
                <div className="px-3 py-2 bg-zinc-900 border-b border-white/[0.07] flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                if (selectedIds.size === snapshots.length) {
                                    setSelectedIds(new Set());
                                } else {
                                    setSelectedIds(new Set(snapshots.map(s => s.id)));
                                }
                            }}
                            className="text-zinc-400 hover:text-white flex items-center gap-1"
                        >
                            {selectedIds.size === snapshots.length ? <CheckSquare className="w-3.5 h-3.5 text-zinc-200" /> : <Square className="w-3.5 h-3.5" />}
                            <span>全选</span>
                        </button>
                        <span className="text-zinc-500 text-xs">已选 {selectedIds.size} 张</span>
                    </div>

                    {selectedIds.size > 0 && (
                        <button
                            onClick={handleBatchDelete}
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/20 font-medium transition text-xs"
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
                    columnsMode === 2 ? 'grid grid-cols-2 gap-2 content-start' : 'space-y-2'
                }`}
            >
                {snapshots.length === 0 ? (
                    <div className="col-span-2 h-full flex flex-col items-center justify-center text-zinc-600 text-xs text-center p-6 gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-white/[0.06] flex items-center justify-center text-zinc-500">
                            <ImageIcon className="w-5 h-5 stroke-[1.5]" />
                        </div>
                        <p className="font-medium text-zinc-400">暂无截图</p>
                        <p className="text-[11px] text-zinc-500 leading-relaxed font-mono">
                            右键快门或按 S 键击发
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
                                className={`group relative rounded-lg overflow-hidden border transition-all cursor-pointer flex flex-col bg-zinc-950/60 ${
                                    isSelected
                                        ? 'border-zinc-300 ring-1 ring-zinc-300 shadow-md'
                                        : 'border-white/[0.07] hover:border-zinc-600'
                                }`}
                            >
                                {/* 完整原比例画面展示容器 */}
                                <div
                                    className="relative w-full overflow-hidden bg-black/80 flex items-center justify-center"
                                    style={{
                                        aspectRatio: item.width && item.height ? `${item.width} / ${item.height}` : '9 / 16',
                                        maxHeight: columnsMode === 1 ? '360px' : '200px',
                                        minHeight: '100px',
                                    }}
                                >
                                    <img
                                        src={item.base64}
                                        alt={item.fileName}
                                        className="w-full h-full object-contain transition-transform duration-150"
                                        loading="lazy"
                                    />

                                    {/* 多选勾选框 */}
                                    {isMultiSelectMode && (
                                        <button
                                            onClick={(e) => toggleSelect(item.id, e)}
                                            className="absolute top-1.5 left-1.5 p-1 rounded bg-black/70 backdrop-blur-sm z-10"
                                        >
                                            {isChecked ? (
                                                <CheckSquare className="w-3.5 h-3.5 text-zinc-200" />
                                            ) : (
                                                <Square className="w-3.5 h-3.5 text-zinc-400" />
                                            )}
                                        </button>
                                    )}

                                    {/* 悬浮删除操作 */}
                                    <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteSingle(item.id, item.filePath);
                                            }}
                                            className="p-1 rounded bg-black/80 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-300 border border-white/10 backdrop-blur-sm transition"
                                            title="删除此张 (Del 键)"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>

                                    {/* 底部尺寸与序号标签 */}
                                    <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between pointer-events-none text-[9px] font-mono text-zinc-400 bg-black/75 px-1.5 py-0.5 rounded backdrop-blur-sm border border-white/[0.06]">
                                        <span className="text-zinc-200 font-semibold">#{idx + 1}</span>
                                        <span>{item.width}×{item.height}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* 底部极简状态指示 */}
            <div className="px-3 py-2 bg-[#090a0d] border-t border-white/[0.07] text-[10px] font-mono text-zinc-500 flex items-center justify-between">
                <span>双击看大图</span>
                <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700/60 text-zinc-400">Del</kbd> 删废片</span>
            </div>

            {/* 沉浸式专业看图器 */}
            {currentLightboxItem && (
                <div
                    onClick={() => setLightboxIndex(-1)}
                    className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-between p-4 select-none animate-in fade-in duration-100"
                >
                    {/* 顶部控制栏 */}
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full flex items-center justify-between px-4 py-2 bg-zinc-900/90 border border-white/[0.08] rounded-xl z-20 backdrop-blur-md"
                    >
                        <div className="flex items-center gap-3">
                            <span className="font-mono font-bold text-zinc-100 text-sm">
                                {lightboxIndex + 1} / {snapshots.length}
                            </span>
                            <span className="text-xs font-mono text-zinc-400">
                                {currentLightboxItem.width} × {currentLightboxItem.height}
                            </span>
                            <span className="text-xs text-zinc-500 truncate max-w-sm" title={currentLightboxItem.fileName}>
                                {currentLightboxItem.fileName}
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* 在系统资源管理器中定位 */}
                            <button
                                onClick={() => openPath(currentLightboxItem.filePath)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs border border-white/[0.06] transition"
                                title="在资源管理器中高亮定位该文件"
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>定位文件</span>
                            </button>

                            {/* 秒删当前大图按钮 */}
                            <button
                                onClick={() => handleDeleteSingle(currentLightboxItem.id, currentLightboxItem.filePath)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-medium shadow-sm transition"
                                title="删除这张截图 (Del 键)"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>删除 (Del)</span>
                            </button>

                            {/* 关闭看图器 */}
                            <button
                                onClick={() => setLightboxIndex(-1)}
                                className="p-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-white/[0.06] transition ml-1"
                                title="退出 (Esc)"
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
                            className="absolute left-6 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-white/10 shadow-2xl transition z-10"
                            title="上一张 (左箭头)"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>

                        {/* 大图画面 */}
                        <img
                            src={currentLightboxItem.base64}
                            alt={currentLightboxItem.fileName}
                            className="max-h-[84vh] max-w-[86vw] object-contain rounded-lg shadow-2xl border border-white/[0.08]"
                        />

                        {/* 下一张按钮 */}
                        <button
                            onClick={handleLightboxNext}
                            className="absolute right-6 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-white/10 shadow-2xl transition z-10"
                            title="下一张 (右箭头)"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>

                    {/* 底部看图快捷操作提示 */}
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="px-3.5 py-1 rounded-full bg-zinc-900/90 border border-white/[0.08] text-[11px] font-mono text-zinc-400 flex items-center gap-2.5 backdrop-blur-md"
                    >
                        <span>◀ ▶ 切换</span>
                        <span className="text-zinc-700">·</span>
                        <span>Del 秒删</span>
                        <span className="text-zinc-700">·</span>
                        <span>Esc 退出</span>
                    </div>
                </div>
            )}
        </aside>
    );
}
