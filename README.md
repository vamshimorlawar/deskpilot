# DeskPilot

**Local AI agents that clean up your filesystem. Nothing leaves your machine.**

[![Download for macOS](https://img.shields.io/badge/download-macOS-000?logo=apple)](https://deskpilot-site.vercel.app/)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB?logo=tauri)](https://tauri.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Point DeskPilot at a folder full of junk. It reads the filenames, proposes a folder structure, and shows you the plan. If you like it, it moves the files. If you don't, one click puts everything back.

The model runs locally through [Ollama](https://ollama.com) — no API key, no subscription, and no file names or contents ever leave your computer.

**[Download for macOS →](https://deskpilot-site.vercel.app/)**

---

## Agents

| Agent | What it does |
|---|---|
| **File Organizer** | Reads a messy directory and proposes named folders with a rationale for each, then moves files into them |
| **Photo Organizer** | Sorts screenshots and photos into a dated structure |

Screenshot renaming, downloads cleanup, and document summarisation are next.

---

## The design: propose, approve, execute, undo

An agent that reorganises your Documents folder needs to be **reversible before it needs to be clever**. So DeskPilot never lets the model touch the filesystem.

The Rust backend splits every agent into separate commands:

```
plan_folder(path)        -> OrgPlan     # read-only: scan, ask the model, return a proposal
execute_plan(path, plan) -> OrganizeResult   # apply a plan the user has approved
undo_last()              -> String      # reverse the last execution
```

`plan_folder` only reads. It walks the directory, builds a prompt from the file listing, and asks `llama3.2:3b` for a structure. Nothing is moved, so a bad suggestion costs nothing — you see the proposed folders and which files land in each before anything happens.

`execute_plan` does the moving, and as it goes it records the inverse of everything it did: each `FileMove` (where the file came from, where it went) and every folder it created. That record is the undo state.

`undo_last` replays the moves in reverse order, then removes the created folders in reverse order — deepest first, so a nested structure unwinds cleanly. A move that fails to reverse is logged and the rest still roll back, so a partial undo never leaves you worse off than a partial execute.

The model is therefore only ever a **suggestion engine**. It proposes; the user approves; Rust performs the mutation and keeps the receipt.

---

## Requirements

- macOS (Windows is in progress)
- [Ollama](https://ollama.com) installed and running
- The `llama3.2:3b` model (~2 GB)

DeskPilot detects all of this at startup: it checks whether Ollama is installed, whether the daemon is up on `localhost:11434`, and whether the model is pulled — and offers to start the daemon or pull the model for you rather than failing with an error.

---

## Development

```bash
npm install
npm run tauri dev      # dev build with hot reload
npm run tauri build    # production bundle
```

**Stack** — Tauri 2, Rust (tokio, reqwest with rustls, walkdir), React 18 + TypeScript, Vite, Tailwind, shadcn/ui.

```
src/                 React UI
src-tauri/src/       Rust backend: agents, Ollama client, undo state
```

---

## Privacy

DeskPilot makes exactly one network call: to `localhost:11434`, your own Ollama daemon. There is no telemetry, no analytics, and no remote API. File names and contents never leave the machine.

## License

MIT — see [LICENSE](LICENSE).
