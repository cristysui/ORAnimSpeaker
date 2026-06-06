# ORAnimSpeaker

语言 / Language: [中文](#中文) | [English](#english)

---

## 中文

ORAnimSpeaker 是一个基于浏览器的视频编辑工具，用于根据音频生成角色动画。

你可以为角色配置“静止”“说话”和额外的手动动作，动作素材可以是视频，也可以是图片序列帧。导入音频后，应用会根据音频中的说话片段在时间线上生成角色动画，并支持在 Player 中预览、添加背景轨道、手动覆盖动作以及从浏览器导出视频。

### 项目来源

ORAnimSpeaker 基于开源项目 [OpenReel](https://github.com/openreel/openreel) 改造而来。

本项目复用了 OpenReel 的 Web/React 编辑器架构、时间线、媒体处理和部分导出能力，并在此基础上重构了左侧素材面板、角色动作配置、音频驱动角色动画生成、手动动画控制台和相关预览交互。

感谢 OpenReel 项目及其贡献者。

### 功能

- 配置必填的静止动作和说话动作。
- 添加额外的手动动作，用于覆盖时间线片段。
- 支持动作视频和图片序列帧两种素材形式。
- 根据音频轨生成角色动画轨道。
- 添加背景色等时间线图层。
- 在浏览器 Player 中预览合成效果。
- 通过 Web 编辑器导出视频。

### 环境要求

- Node.js 20 或更高版本
- pnpm 9
- 推荐使用 Chrome 或其他现代 Chromium 内核浏览器

预览和导出性能取决于用户的浏览器、CPU、GPU、内存、媒体格式和项目复杂度。

### 快速开始

```bash
corepack enable
corepack prepare pnpm@9.0.0 --activate
pnpm install
pnpm dev
```

打开：

```text
http://localhost:5173/#/editor
```

如果依赖已经通过 pnpm 安装完成，也可以使用根目录的 npm 脚本：

```bash
npm run dev
```

这个 npm 脚本内部仍会调用 pnpm，因为当前仓库使用 pnpm workspaces。

### 构建

```bash
pnpm build
pnpm preview
```

生产构建来自 `apps/web`。

### 项目结构

```text
apps/web        Web 编辑器应用
packages/core   时间线、媒体、预览、导出、存储和引擎逻辑
packages/ui     共享 UI 组件
scripts         工具脚本
docs            项目说明和设计文档
```

当前维护目标是浏览器版本，即 `localhost:5173`。旧的 Electron 原型和未使用的 image-editor 包已经从当前精简工作区中移除。

### 本地数据

项目数据主要保存在用户浏览器本地，通过 IndexedDB 和 localStorage 存储。

常见存储包括：

```text
localStorage:
  or-animspeaker:recent-projects

IndexedDB:
  openreel-autosave
  openreel-projects
  openreel-db
```

因为这些数据保存在浏览器本地，清理浏览器数据、切换浏览器、使用无痕模式或更换电脑，都可能导致本地项目历史无法恢复。

### 开发命令

```bash
pnpm dev          # 启动 Web 编辑器
pnpm build        # 构建 WASM 辅助模块和 Web 应用
pnpm preview      # 预览生产构建
pnpm typecheck    # 运行 TypeScript 类型检查
pnpm test         # 运行测试
pnpm lint         # 运行 lint
```

### 说明

- 当前视频导出主要在浏览器端执行。
- 大视频文件和长时间线项目可能会比较慢，具体取决于用户设备。
- 由于项目源自 OpenReel，内部包名如 `@openreel/core` 以及部分存储 key 仍保留原名称，用于兼容现有代码和本地数据。

---

## English

ORAnimSpeaker is a browser-based editor for creating audio-driven character animation.

It lets you bind character actions to videos or image sequences, import an audio track, generate character animation on the timeline, preview the result in the Player, add background layers, apply manual action overrides, and export the final video from the browser.

### Origin

ORAnimSpeaker is built on top of the open-source project [OpenReel](https://github.com/openreel/openreel).

This project reuses OpenReel's Web/React editor architecture, timeline, media processing, and parts of its export pipeline. On top of that foundation, ORAnimSpeaker redesigns the asset panel, character action configuration, audio-driven character animation generation, manual animation console, and related preview interactions.

Thanks to the OpenReel project and its contributors.

### Features

- Configure required idle and talking actions.
- Add extra manual actions for timeline overrides.
- Use either action videos or image sequences.
- Generate a character animation track from an audio track.
- Add background colors and other timeline layers.
- Preview the composition in the browser Player.
- Export video through the web editor.

### Requirements

- Node.js 20 or newer
- pnpm 9
- Chrome or another modern Chromium-based browser is recommended

Preview and export performance depends on the user's browser, CPU, GPU, memory, media format, and project complexity.

### Quick Start

```bash
corepack enable
corepack prepare pnpm@9.0.0 --activate
pnpm install
pnpm dev
```

Open:

```text
http://localhost:5173/#/editor
```

If dependencies are already installed, this root npm script also works:

```bash
npm run dev
```

The npm script delegates to pnpm internally because this repository uses pnpm workspaces.

### Build

```bash
pnpm build
pnpm preview
```

The production build is generated from `apps/web`.

### Project Layout

```text
apps/web        Web editor application
packages/core   Timeline, media, preview, export, storage, and engine logic
packages/ui     Shared UI components
scripts         Utility scripts
docs            Project notes and design documents
```

The current maintained target is the browser version at `localhost:5173`. The older Electron prototype and the unused image-editor package have been removed from this trimmed workspace.

### Local Data

Project data is stored in the user's browser, mainly through IndexedDB and localStorage.

Common stores include:

```text
localStorage:
  or-animspeaker:recent-projects

IndexedDB:
  openreel-autosave
  openreel-projects
  openreel-db
```

Because this is browser-local data, clearing browser data, switching browsers, using private browsing, or moving to another computer may make local project history unavailable.

### Development Commands

```bash
pnpm dev          # Start the web editor
pnpm build        # Build WASM helpers and the web app
pnpm preview      # Preview the production build
pnpm typecheck    # Run TypeScript checks across workspaces
pnpm test         # Run tests across workspaces
pnpm lint         # Run lint checks across workspaces
```

### Notes

- Browser export currently runs on the client side.
- Large video files and long timelines can be slow depending on the machine.
- Since the project is based on OpenReel, internal package names such as `@openreel/core` and some storage keys remain unchanged for compatibility with the existing codebase and local data.
