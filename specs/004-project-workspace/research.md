# Research: Project Workspace

Docs checked with Context7 on 2026-11-13: `notify-debouncer-full`, Tauri 2 webview drag-drop, `tauri-plugin-opener`.

## R1. Compiling with unsaved edits in several files

- **Decision**: Keep compiling in the build folder. Before each compile, write every *modified* open file into `<build>\overlay\<relative path>` (the folder is cleared first), and run latexmk with `TEXINPUTS=<build>\overlay;<project root>;` and the same value for `BIBINPUTS`. The main document's snapshot stays at `<build>\<stem>.tex`, as today. Also create the project's subfolder tree (folders only) inside `<build>` so `\include{chapters/intro}` can write `chapters\intro.aux`.
- **Rationale**: Saved files and images are read straight from the project, so nothing is copied except the few unsaved text files (normally zero or one). This answers the spec's risk about copying a large project for every live-preview run. It extends the existing `TEXINPUTS=<doc folder>;` approach, which the `compile_end_to_end_when_tools_are_installed` test already proves.
- **Alternatives considered**: Copying the whole project into the build folder each compile (slow with images, and doubles disk use). Saving unsaved files before live preview (breaks FR-010 and the "compiling never touches the user's file" rule).
- **Risk**: TeX searches the current folder before `TEXINPUTS`, so a file in `<build>` with the same relative name would win. Only latexmk's own output (`<stem>.*` and `.aux` files) lives there, so this is safe. The e2e test gets a new case: a sub-file with unsaved edits plus an image in the project.

## R2. Paths and confinement (FR-007)

- **Decision**: The backend owns the open project. A managed `ProjectState` holds the canonical root. Every file command takes a **project-relative** path and resolves it with one helper, `resolve_in_project(rel)`. The helper rejects absolute paths, `..`, drive or UNC prefixes and reserved Windows names. It canonicalizes the nearest existing ancestor and requires the result to `starts_with` the canonical root, which also catches junctions and symlinks pointing out of the project.
- **Rationale**: One choke point, unit-testable without Tauri. The frontend never handles absolute paths except the folder picked in "Open folder…".
- **Alternatives considered**: Validating absolute paths sent by the frontend (more places to get wrong). The Tauri fs plugin with scopes (adds a capability surface; the project already does file IO in Rust).

## R3. Watching the folder for outside changes (FR-012)

- **Decision**: `notify-debouncer-full` (recursive watch on the project root, 500 ms debounce). Events under the build-clutter and hidden names are ignored. Events go to the frontend as `project-changed { paths: string[] }` (relative paths). The frontend re-lists affected folders and reloads clean open files; dirty open files get the "Reload / Keep mine" notice. Writes made by Lexy itself are suppressed by comparing the file's modified time with the time Lexy last saved it.
- **Rationale**: Native ReadDirectoryChangesW behind a maintained crate; the full debouncer merges rename pairs, so a rename is one event and not a delete plus a create. Meets the 2 s budget.
- **Alternatives considered**: Polling on window focus (misses changes while Lexy is in the foreground beside Explorer). Raw `notify` (needs our own debounce).

## R4. Recycle Bin (FR-006)

- **Decision**: The `trash` crate (`trash::delete`, IFileOperation on Windows). If it fails because the drive has no Recycle Bin, return a typed error `NoRecycleBin` and let the UI ask "Delete permanently?" before calling `delete_entry` with `permanent: true`.
- **Alternatives considered**: PowerShell `Microsoft.VisualBasic.FileIO` through `run_command` (slow, spawns a process per delete). Calling the Windows shell API directly (more unsafe code for no gain).

## R5. Drag-and-drop from Explorer

- **Decision**: Use Tauri's native drag-drop (`getCurrentWebview().onDragDropEvent`; it is on by default). The `drop` payload gives absolute paths plus a position; the sidebar maps the position to the folder under the cursor and calls `import_files(sources, targetDir)`. Source paths come from the OS drop, so Rust only checks that they exist and are files or folders; the **target** goes through `resolve_in_project`.
- **Note**: The native handler disables HTML5 drag-and-drop inside the webview on Windows. Lexy uses none today, so moving files *inside* the sidebar by dragging is out of scope for v1 (use Rename to move).

## R6. Opening non-text files

- **Decision**: A Rust command `open_entry_external(rel)` resolves the path inside the project, then calls `app.opener().open_path(...)`. No `opener:allow-open-path` capability is added to the frontend, so capabilities stay minimal.

## R7. Per-file editor state (FR-008, SC-004)

- **Decision**: `Editor.tsx` keeps one CodeMirror `EditorState` per open file in a `Map<relPath, EditorState>`. Switching calls `view.setState(saved)`, which restores text, selection and undo history and costs well under 100 ms. The current `value`-prop reset path stays for "Reload from disk". `EditorHandle` gains `switchTo(rel, text)`, `textOf(rel)` and `applyTo(rel, edit)`; the last is for ribbon settings that target the main document while a sub-file is shown (FR-017). It applies a transaction to the stored state, so the change is still one undo step in that file.
- **Alternatives considered**: One editor and saving text on switch (loses undo, violates FR-008). Multiple hidden editor views (more memory, more focus bugs).

## R8. Persisted data: recent projects and main document

- **Decision**: `%LOCALAPPDATA%\Lexy\projects.json`, written atomically with the existing `write_atomic`: `{ version: 1, lastOpen: path | null, projects: [{ path, mainDocument, lastOpened }] }`, max 20 entries outside the default folder. Nothing is written into project folders.
- **Alternatives considered**: `tauri-plugin-store` (another plugin and capability for one small file). A `.lexy` file in each project (pollutes user folders; the spec forbids it).

## R9. Same project open twice

- **Decision**: On open, take an exclusive lock on `%LOCALAPPDATA%\Lexy\Locks\<hash(root)>.lock` with `std::fs::File::try_lock` (stable since Rust 1.89; toolchain is 1.99). The OS releases it when the process exits, even after a crash. If the lock is held, the project opens read-only: save, compile, file operations and the watcher's reload are disabled, and a notice is shown.

## R10. Main document detection (FR-009)

- **Decision**: Candidates are the top-level `*.tex` files whose text before `\begin{document}` contains an uncommented `\documentclass`. Exactly one candidate means it is the main document. Otherwise the remembered choice in `projects.json` is used if it still exists; otherwise the UI asks. Reading stops at 64 KiB per file.

## R11. Large folders

- **Decision**: The sidebar lists lazily, one folder at a time when expanded (`list_dir(rel)`), so even huge folders never block. "Open folder…" first runs a bounded count (`count_entries(root, limit: 5001)`, skipping ignored names). Over 5,000 entries shows the spec's warning.

## R12. Startup flow

- **Decision**: `App.tsx` goes from checking to setup to a new `ProjectHome.tsx` or `Writer.tsx`. If `projects.json` has a `lastOpen` whose folder still exists, the Writer opens it directly. Otherwise the app shows Project Home. Launching with a `.tex` argument stays out of scope (Lexy has no file association yet); File → Open (a `.tex` file) opens its folder as the project with that file preselected as main.
