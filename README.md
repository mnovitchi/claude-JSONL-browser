# JSONL Browser — Desktop (Tauri) Fork

> **This is a fork of [withLinda/claude-JSONL-browser](https://github.com/withLinda/claude-JSONL-browser).**
> All credit for the original tool goes to [Linda](https://withlinda.dev). This fork tracks upstream and adds a way to run the tool as a native desktop app.

## What's different in this fork

This fork wraps the existing client-side web app in a [Tauri](https://tauri.app/) shell so it can be distributed as a **standalone desktop executable** — no browser, no dev server, fully offline.

- **Standalone executable** — produces a single portable `jsonl-browser.exe` (~8.4 MB) on Windows, using the OS's built-in WebView2 (no bundled Chromium).
- **Static export** — `next.config.mjs` enables `output: 'export'` so the app builds to `out/` for embedding in the native shell.
- **Fully offline** — removed `@vercel/analytics`; the desktop build makes no network calls.
- **Installers too** — `tauri build` also emits an MSI (~3 MB) and an NSIS setup `.exe` (~2 MB).
- **macOS-capable** — the same codebase builds a `.app`/`.dmg` on a Mac (Tauri can't cross-compile from Windows; macOS validation is tracked in [issue #2](https://github.com/mnovitchi/claude-JSONL-browser/issues/2)).

### Building the desktop app

```bash
npm install

npm run tauri:build   # release build → src-tauri/target/release/jsonl-browser.exe
npm run tauri:dev     # native dev window with live reload
```

The original web workflows (`npm run dev` / `npm run build`) are unchanged.

---

# Original README

> The content below is the original README from the upstream project, preserved unchanged.

⚠️ **UNDER MAINTENANCE** - This project is still being actively developed. Some features may be incomplete or change without notice.

# Claude Code Log Viewer

A web-based tool that converts Claude Code CLI conversation logs (JSONL format) into human-readable Markdown. Features a built-in file explorer for managing multiple logs at once.

🌐 **Live Demo**: [jsonl.withlinda.dev](https://jsonl.withlinda.dev)

## What is this?

Claude Code CLI automatically saves all your conversations in JSONL format at `~/.claude/projects/`. These logs are difficult to read in their raw form. This tool makes them human-readable by:

- Converting JSONL to formatted Markdown
- Preserving conversation structure and timestamps
- Highlighting model changes and tool usage
- Organizing multiple sessions for easy browsing

## Quick Start

### Using the Web Version

1. Visit [jsonl.withlinda.dev](https://jsonl.withlinda.dev)
2. Locate your Claude Code logs:
   - **On Mac**: Press `Shift+Cmd+G` in Finder and type `~/.claude/projects/`
   - **On Linux**: Navigate to `~/.claude/projects/` in your file manager
   - **On Windows**: Navigate to `%UserProfile%/.claude/projects/` in your file manager
   
   ![Go to Folder in Finder](Readme-images/Go-to-folder.png)
3. Drag & drop or upload your `.jsonl` files
4. View, search, and export your conversations

![Claude Code JSONL Viewer Interface](Readme-images/Claude-Code-CLI-JSONL-viewer-converter-to-Markdown.png)

### Running Locally

```bash
# Clone and install
git clone https://github.com/withLinda/claude-JSONL-browser.git
cd ClaudeJSONLbrowser
npm install

# Start development server
npm run dev
# Open http://localhost:3000
```

## Features

- **Multi-file Management**: Process multiple conversation logs simultaneously
- **Smart Parsing**: Automatically extracts session metadata, timestamps, and conversation flow
- **Search**: Find content across all loaded conversations
- **Export Options**: Download individual or combined Markdown files
- **Tool Use Formatting**: Clearly displays when Claude uses tools and their outputs
- **Model Change Tracking**: Highlights when you switch between Claude models

## What Gets Processed

The tool specifically handles Claude Code CLI log structure:

- **Session Metadata**: Session ID, Git branch, working directory
- **Message Types**: User messages, Claude responses, system summaries
- **Special Commands**: `/model` changes, tool uses, command outputs
- **Timestamps**: Preserves all timing information

## Build Instructions

```bash
# Production build
npm run build

```

## Tech Stack

- Next.js 15 with TypeScript
- Tailwind CSS (Everforest theme)
- Client-side processing (no data sent to servers)

## Why This Exists

Claude Code CLI doesn't have a built-in export feature for conversation history. This tool fills that gap, making it easy to:
- Review past conversations
- Share solutions with your team
- Create documentation from Claude interactions
- Analyze your Claude usage patterns

---

Created for the Claude Code community by [Linda](https://withlinda.dev)
