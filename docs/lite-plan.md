# 极简轻量化路线规划 (Branch: lite)

> 目标：将体积从 435MB 压缩至 30MB 左右，保留全部现有视频截图、优选与横转竖功能，仅交付免安装绿色版。

## 1. 架构变革方案

| 模块 | 旧方案 (main) | 极简方案 (lite) |
| :--- | :--- | :--- |
| **GUI 容器** | Electron (Chromium + Node.js ~200MB) | Tauri 2.0 (系统自带 WebView2 ~10MB) |
| **系统后端** | Node.js (electron-main.js) | Rust Commands (原生多线程与管道) |
| **前端应用** | React 19 + Tailwind CSS | 保留 100% 现有前端代码，仅替换 IPC 驱动层 |
| **视频引擎** | ffmpeg-static 通用包 (~79MB) | 裁剪版 FFmpeg (~12MB) 或独立按需加载 |
| **交付产物** | NSIS 安装版 / 目录绿色版 | **仅保留便携绿色版 (Portable)** |

---

## 2. 核心迁移与改造清单

### A. 前端 IPC 抽象层 (前端零破坏)
- 封装统一的 `src/services/bridge.js`，抹平 Electron 的 `ipcRenderer.invoke` 与 Tauri 的 `@tauri-apps/api/core::invoke`。
- 移除前端所有 `window.require('electron')`、`window.require('fs')` 等 Node 原生调用，改为通过 Bridge 请求 Rust。

### B. Rust 后端平替 (预计 200 行以内)
- `select_folder`：调用原生文件夹选取对话框。
- `open_folder`：原生系统资源管理器打开。
- `get_video_info`：通过子进程调用 ffmpeg 读取时长/分辨率/FPS。
- `process_media`：处理特殊封装/转码（如 HEVC、IDM 错误流）。
- `extract_frames` / `extract_frames_smart`：执行管道批处理抽帧。

### C. FFmpeg 极限瘦身
- 准备一个专用于本项目的 Minified FFmpeg 二进制（只留 demuxers: mp4/mkv/flv/mov, decoders: h264/hevc/vp9, encoders: mjpeg, filters: fps/scale/mpdecimate）。

---

## 3. 明日开工执行顺序

1. **环境准备**：检查并配置 Rust (rustup / cargo) 与 WebView2 编译环境。
2. **脚手架初始化**：在本项目根目录执行 `cargo tauri init`，建立 `src-tauri` 架构。
3. **Rust Commands 实现**：逐一移植 `electron-main.js` 中的 5 个核心 IPC 处理函数。
4. **前端 Bridge 接入**：无缝桥接前端并运行开发预览 (`npm run tauri dev`)。
5. **清理冗余**：移除 Electron、electron-builder、concurrently 等过时依赖。
6. **产物构建与体积验收**：验证单版本绿色版输出体积与抽帧性能。
