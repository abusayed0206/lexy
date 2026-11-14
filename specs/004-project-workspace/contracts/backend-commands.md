# Contract: Project backend commands (Rust ↔ frontend)

Tauri commands in `src-tauri/src/project.rs`, registered in `lib.rs`. Structs serialize camelCase. Paths named `rel` are project-relative and go through `resolve_in_project` (research R2). Errors where the UI branches use:

```ts
type ProjectError = { kind: "outsideProject" | "notFound" | "nameTaken" | "invalidName" | "noRecycleBin" | "readOnly" | "noProject" | "io"; message: string };
```

## Project Home

### `list_projects() -> ProjectSummary[]`

```ts
type ProjectSummary = { path: string; name: string; modified: number; lastOpened: number | null; inDefaultFolder: boolean; missing: boolean };
```

Lists folders directly inside the default folder plus recent entries from `projects.json`. Sorted by `lastOpened` desc, then `modified`; deduplicated.

### `last_open_project() -> string | null`

Returns `lastOpen` from `projects.json` if that folder still exists.

### `create_project(name: string) -> string`

Creates `<default folder>\<name>\<name>.tex` with the starter text (passed from the frontend as `starter: string`). Uses `<name> (2)`, `(3)`… if taken. Returns the folder path. Rejects invalid Windows names (`invalidName`).

### `count_entries(path: string, limit: number) -> number`

Bounded count for the large-folder warning (R11). Absolute path, since no project is open yet; read-only.

### `forget_project(path: string)`

Removes an entry from the recent list ("Remove from list").

## Open project

### `open_project(path: string) -> OpenedProject`

```ts
type OpenedProject = { root: string; name: string; readOnly: boolean; mainDocument: string | null; candidates: string[] };
```

Closes any open project, canonicalizes `path`, takes the lock (R9), starts the watcher, updates `projects.json` (`lastOpen`, `lastOpened`). `mainDocument` is set when detection is unambiguous or remembered (R10); otherwise null with `candidates` listed.

### `close_project()`

Drops the lock and watcher, sets `lastOpen` to null. Called when going to Project Home. The window-close path leaves `lastOpen` set so the project reopens next time.

### `set_main_document(rel: string)`

Must be an existing `.tex` file; remembered in `projects.json`.

## Files (all fail with `readOnly` for writes when the project is read-only)

| Command | Result | Notes |
|---------|--------|-------|
| `list_dir(rel: string)` | `Entry[]` | `""` = root. Folders first, then names, case-insensitive. See data-model for `Entry`. |
| `read_file(rel)` | `string` | UTF-8, ≤ 10 MiB, editable extensions only (same rules as today's `read_document`). |
| `write_file(rel, contents)` | `void` | Atomic (existing `write_atomic`); records mtime for watcher suppression. |
| `create_file(rel)` | `void` | Fails `nameTaken` if it exists. Creates an empty file. |
| `create_folder(rel)` | `void` | Fails `nameTaken` if it exists. |
| `rename_entry(from, to)` | `void` | Both inside the project; `to` must not exist; also used to move into another folder. |
| `delete_entry(rel, permanent: bool)` | `void` | `permanent: false` → Recycle Bin; `noRecycleBin` when unavailable (R4). Deleting the root is refused. |
| `import_files(sources: string[], targetDir: rel, onConflict: "replace" \| "keepBoth" \| "skip" \| "ask")` | `ImportResult` | Copies OS-dropped files/folders in. With `"ask"`, returns conflicts without copying them so the UI can ask once and call again. |
| `open_entry_external(rel)` | `void` | Opens with the default Windows app via opener (R6). |

```ts
type ImportResult = { copied: string[]; skipped: string[]; conflicts: string[] };
```

## Compile

### `compile_project(main: string, buffers: { path: string; text: string }[]) -> CompileResult`

Replaces `compile_source` for projects (same `CompileResult` shape). It writes the main snapshot to `<build>\<stem>.tex`, rewrites `<build>\overlay\` with the dirty buffers, mirrors the project's folder tree into `<build>`, and runs latexmk with `TEXINPUTS` and `BIBINPUTS` set to `<build>\overlay;<root>;` (R1). The compile lock, timeout, engine marker and log rules are unchanged. The main snapshot's text comes from `buffers` if present, else from disk.

`compile_source` stays only for the untitled-document path until it is removed in the cleanup phase.

### `export_pdf(pdfPath, documentPath)`

Unchanged, called with the absolute main document path.

## Events

| Event | Payload | When |
|-------|---------|------|
| `project-changed` | `{ paths: string[] }` (relative, deduplicated) | Debounced outside changes (R3), excluding Lexy's own writes and ignored names |
| `project-missing` | `{}` | The root folder disappears or the watcher fails |

## Removed or replaced

`read_document`, `write_document` and `prepare_save_path` are superseded by the project commands. `default_document_folder` stays (Project Home shows it, with the fallback notice).
