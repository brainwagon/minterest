# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**minterest** is a local-first, browser-based "Pinterest-like" application. It runs 100% in the browser using IndexedDB — no build step, no server required, no framework. The philosophy is simplicity, privacy, and technical longevity.

## Development

**No build step.** Open `index.html` directly in a browser, or serve via any static file server:
```bash
python3 -m http.server 8000
```

**Tests** are browser-based HTML harnesses — open each manually:
- `tests/index.html` → storage tests
- `tests/loading.html` → loading tests
- `tests/persistence.html` → persistence tests
- `tests/theme.html` → theme tests
- `tests/toggle.html` → toggle tests

**minterestd** (optional backup server):
```bash
cd minterestd
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python3 app.py --port 5000 --max-backups 5
```

## Architecture

**Frontend (static files):**
- `storage.js` — IndexedDB abstraction. All DB access goes through here. Stores: `topics`, `items`, `settings`.
- `app.js` — All application logic (~2300 lines). Handles rendering, navigation, drag-and-drop, backup, and theme.
- `index.html` — SPA shell with all modal dialogs.
- `style.css` — Theming via CSS variables (light/dark), masonry layouts.

External libraries loaded via ESM CDN (no npm): `idb`, `SortableJS`, `PeerJS`, `JSZip`, `qrcode`.

**Data model:**
- **Topics**: boards with `{ id, name, parentId, color, order }` — supports nesting
- **Items**: cards with `{ id, topicId, type: 'link'|'image'|'note', content, title, order }`
- **Settings**: key-value pairs (theme, server URL, etc.)

**minterestd** (`minterestd/app.py`): Flask + SQLite backup server. REST API at `/api/backups`. Uses HTTP Basic Auth. Ansible playbook in `minterestd/ansible/` for deployment to Debian servers.

## Conductor (Project Management)

The `conductor/` directory contains living project documentation:
- `conductor/tracks/` — active work tracks, each with `index.md`, `spec.md`, `plan.md`, `metadata.json`
- `conductor/archive/` — completed tracks
- `conductor/product.md`, `conductor/product-guidelines.md` — product vision and UX principles
- `conductor/tech-stack.md` — **must be updated before changing the tech stack**
- `conductor/workflow.md` — TDD workflow, task lifecycle, commit protocol

**Track workflow:** Tasks follow Red→Green→Refactor TDD. Plan is the source of truth. Each completed task gets a git note attached (`git notes add`). Phase completions get checkpoint commits.

## Code Style

JavaScript follows the Google JavaScript Style Guide (see `conductor/code_styleguides/javascript.md`):
- ES modules, named exports only (no default exports), `.js` extension required in imports
- `const` by default, `let` if needed, `var` forbidden
- Single quotes, semicolons required, 2-space indent, 80-char line limit
- Arrow functions for nested functions; `===`/`!==` always
- JSDoc on all public functions with `@param`/`@return` types

## Commit Format

```
<type>(<scope>): <description>
```
Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

After each task commit: attach a git note with `git notes add -m "<summary>" <hash>`.
