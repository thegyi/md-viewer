# md-viewer

A desktop markdown viewer built with Rust + Tauri.

## Features

- CommonMark + GFM rendering (markdown-it)
- Syntax highlighting (highlight.js)
- Math via KaTeX (`$...$`, `$$...$$`)
- Mermaid diagrams (```` ```mermaid ```` blocks)
- Live reload when the file changes on disk
- Drag & drop a file onto the window to open it

## Requirements

- Rust (stable)
- Node.js 18+
- Linux: `webkit2gtk-4.1`, `gtk+-3.0` (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

## Usage

```bash
npm install
npm run build
npm start -- path/to/file.md
```

`npm start` runs `cargo run` inside `src-tauri/`; pass the markdown file as the argument.
