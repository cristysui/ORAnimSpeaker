# ORAnimSpeaker

ORAnimSpeaker is a browser-based editor for creating audio-driven character animation.

It lets you bind character actions to videos or image sequences, import an audio track, generate character animation on the timeline, preview the result in the Player, and export the final video from the browser.

## Features

- Configure required idle and talking actions.
- Add extra manual actions for timeline overrides.
- Use either action videos or image sequences.
- Generate a character animation track from an audio track.
- Add background colors and other timeline layers.
- Preview the composition in the browser Player.
- Export video through the web editor.

## Requirements

- Node.js 20 or newer
- pnpm 9
- Chrome or another modern Chromium-based browser is recommended

Preview and export performance depends on the user's browser, CPU, GPU, memory, media format, and project complexity.

## Quick Start

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

## Build

```bash
pnpm build
pnpm preview
```

The production build is generated from `apps/web`.

## Project Layout

```text
apps/web        Web editor application
packages/core   Timeline, media, preview, export, storage, and engine logic
packages/ui     Shared UI components
scripts         Utility scripts
docs            Project notes and design documents
```

The current maintained target is the browser version at `localhost:5173`. The older Electron prototype and the unused image-editor package have been removed from this trimmed workspace.

## Local Data

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

## Development Commands

```bash
pnpm dev          # Start the web editor
pnpm build        # Build WASM helpers and the web app
pnpm preview      # Preview the production build
pnpm typecheck    # Run TypeScript checks across workspaces
pnpm test         # Run tests across workspaces
pnpm lint         # Run lint checks across workspaces
```

## Notes

- Browser export currently runs on the client side.
- Large video files and long timelines can be slow depending on the machine.
- Existing internal package names such as `@openreel/core` and some storage keys remain for compatibility with the original codebase.
