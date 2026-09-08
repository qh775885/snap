import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Trash2, FolderOpen, ExternalLink, CheckSquare, Square, X, Eye } from 'lucide-react';
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
    const [lightboxItem, setLightboxItem] = useState(null);

    const listContainerRef = useRef(null);

    // 当有新截图加入时，默认选中最新的一张并滚动到顶部
    useEffect(() => {
        if (snapshots.length > 0 && !selectedId) {
            setSelectedId(snapshots[0].id);
        }
    }, [snapshots, selectedId]);

    // ===== 键盘流极速清点与秒删废片 =====
    const handleDeleteSingle = useCallback((id, filePath) => {
        if (onDeleteSnapshot) {
            onDeleteSnapshot(id, filePath);
        }
        // 从多选中移除
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
        // 自动将焦点顺移到下一张
        const currIndex = snapshots.findIndex(s => s.id === id);
        if (currIndex !== -1 && snapshots.length > 1) {
            const nextItem = snapshots[currIndex + 1] || snapshots[currIndex - 1];
            if (nextItem) {
                setSelectedId(nextItem.id);
            }
        } else {
            setSelectedId(null);
        }
        if (lightboxItem && lightboxItem.id === id) {
            setLightboxItem(null);
        }
    }, [onDeleteSnapshot, snapshots, lightboxItem]);

    const handleBatchDelete = () => {
        if (selectedIds.size === 0) return;
        if (onBatchDeleteSnapshots) {
            onBatchDeleteSnapshots(Array.from(selectedIds));
        }
        setSelectedIds(new Set());
        setSelectedId(null);
    };

    // 全局键盘 Del 监听
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Delete 键或 Backspace 秒删当前选中的截图
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
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                // 切换到下一张
                const currIdx = snapshots.findIndex(s => s.id === selectedId);
                if (currIdx !== -1 && currIdx < snapshots.length - 1) {
                    setSelectedId(snapshots[currIdx + 1].id);
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                // 切换到上一张
                const currIdx = snapshots.findIndex(s => s.id === selectedId);
                if (currIdx > 0) {
                    setSelectedId(snapshots[currIdx - 1].id);
                }
            } else if (e.key === 'Escape') {
                if (lightboxItem) setLightboxItem(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedId, selectedIds, snapshots, lightboxItem, handleDeleteSingle]);

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
        <aside className="w-80 h-full bg-[#11141a] border-l border-slate-800/80 flex flex-col select-none text-slate-200">
            {/* 顶部标题与目录信息栏 */}
            <div className="p-3.5 border-b border-slate-800 flex flex-col gap-2 bg-[#141820]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm tracking-wide text-white">靶场图库</span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            {snapshots.length} 张
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
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

                        <button
                            onClick={() => outputDir && openPath(outputDir)}
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition"
                            title="在资源管理器中打开输出目录"
                        >
                            <FolderOpen className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* 存储路径缩略展示与切换 */}
                <div className="flex items-center justify-between text-[11px] text-slate-400 gap-2">
                    <span className="truncate" title={outputDir || '未指定输出目录'}>
                        {outputDir ? outputDir.split(/[\\/]/).slice(-2).join('/') : '默认保存在桌面/视频快门'}
                    </span>
                    <button
                        onClick={onSelectOutputDir}
                        className="text-emerald-400 hover:underline shrink-0"
                    >
                        更换
                    </button>
                </div>
            </div>

            {/* 多选批量操作工具条 */}
            {isMultiSelectMode && (
                <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs">
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

            {/* 截图列表 */}
            <div
                ref={listContainerRef}
                className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar"
            >
                {snapshots.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs text-center p-6 gap-2">
                        <p>尚无截图记录</p>
                        <p className="text-[11px] text-slate-400">
                            在取景器中点击 <span className="text-emerald-400 font-bold">鼠标右键</span> 或按 <span className="text-emerald-400 font-bold">S</span> 键瞬间击发快门
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
                                onDoubleClick={() => openPath(item.filePath)}
                                className={`group relative rounded-xl overflow-hidden border transition-all cursor-pointer ${
                                    isSelected
                                        ? 'border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.25)] bg-slate-900/90 ring-1 ring-emerald-400'
                                        : 'border-slate-800/80 bg-slate-900/40 hover:border-slate-700'
                                }`}
                            >
                                {/* 缩略图画面 */}
                                <div className="relative aspect-[9/16] max-h-60 w-full overflow-hidden bg-black/40 flex items-center justify-center">
                                    <img
                                        src={item.base64}
                                        alt={item.fileName}
                                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-150"
                                        loading="lazy"
                                    />

                                    {/* 多选勾选框 */}
                                    {isMultiSelectMode && (
                                        <button
                                            onClick={(e) => toggleSelect(item.id, e)}
                                            className="absolute top-2 left-2 p-1 rounded bg-black/60 backdrop-blur-sm z-10"
                                        >
                                            {isChecked ? (
                                                <CheckSquare className="w-4 h-4 text-emerald-400" />
                                            ) : (
                                                <Square className="w-4 h-4 text-slate-400" />
                                            )}
                                        </button>
                                    )}

                                    {/* 悬浮操作快捷图标 */}
                                    <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setLightboxItem(item);
                                            }}
                                            className="p-1 rounded bg-black/70 hover:bg-black text-slate-300 hover:text-white backdrop-blur-sm"
                                            title="放大预览"
                                        >
                                            <Eye className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openPath(item.filePath);
                                            }}
                                            className="p-1 rounded bg-black/70 hover:bg-black text-slate-300 hover:text-white backdrop-blur-sm"
                                            title="定位文件"
                                        >
                                            <ExternalLink className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteSingle(item.id, item.filePath);
                                            }}
                                            className="p-1 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 hover:text-white backdrop-blur-sm"
                                            title="删除此张 (Del 键)"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>

                                    {/* 底部尺寸与序号标签 */}
                                    <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between pointer-events-none text-[10px] font-mono text-slate-300 bg-black/60 px-2 py-0.5 rounded backdrop-blur-sm">
                                        <span>#{snapshots.length - idx}</span>
                                        <span>{item.width}×{item.height}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* 底部快捷键提示 */}
            <div className="p-3 bg-[#0d1017] border-t border-slate-800 text-[11px] text-slate-400 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                    <span>💡 快捷淘汰废片：</span>
                    <span className="font-mono text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">Del 键秒删</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>上下方向键快速选片</span>
                    <span>双击卡片直接定位</span>
                </div>
            </div>

            {/* 全屏放大查看灯箱 */}
            {lightboxItem && (
                <div
                    onClick={() => setLightboxItem(null)}
                    className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-6 select-none"
                >
                    <button
                        onClick={() => setLightboxItem(null)}
                        className="absolute top-4 right-4 p-2 rounded-full bg-slate-800/80 hover:bg-slate-700 text-white"
                    >
                        <X className="w-6 h-6" />
                    </button>
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="relative max-w-full max-h-full flex flex-col items-center gap-3"
                    >
                        <img
                            src={lightboxItem.base64}
                            alt={lightboxItem.fileName}
                            className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl border border-slate-800"
                        />
                        <div className="flex items-center gap-4 text-xs font-mono text-slate-400 bg-slate-900/80 px-4 py-1.5 rounded-full border border-slate-700">
                            <span>{lightboxItem.fileName}</span>
                            <span>{lightboxItem.width} × {lightboxItem.height}</span>
                            <button
                                onClick={() => handleDeleteSingle(lightboxItem.id, lightboxItem.filePath)}
                                className="text-rose-400 hover:text-rose-300 font-sans"
                            >
                                删除 (Del)
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </aside>
    );
}
