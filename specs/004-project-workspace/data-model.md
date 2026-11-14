# Data Model: Project Workspace

## Project (backend, managed `ProjectState`)

| Field | Type | Rules |
|-------|------|-------|
| root | canonical absolute path | Existing folder; set by `open_project`; all file paths resolve against it (R2) |
| name | string | Folder name |
| mainDocument | relative path or null | `.tex` file inside root; detection in R10 |
| readOnly | bool | true when another Lexy process holds the lock (R9) |
| lock | file handle | Held while the project is open; dropped on close |
| watcher | debouncer | Watches root recursively; dropped on close |

State: `none → open(readOnly?) → none`. Opening a project while another is open closes the old one first, but the frontend runs the unsaved-changes guard before asking.

## Entry (sidebar row)

| Field | Type | Rules |
|-------|------|-------|
| path | relative path, `\`-separated | Never absolute, never `..` |
| name | string | Valid Windows file name |
| kind | `"file" \| "folder"` | |
| editable | bool | Extension in `tex, bib, cls, sty, txt, bst, md` |
| hidden | bool | Name starts with `.`, or the extension/name is build clutter (`aux log fls fdb_latexmk synctex.gz out toc bbl blg bcf run.xml lof lot`) |
| modified | ms since epoch | For Project Home sort and change suppression |

## RecentProjects (`%LOCALAPPDATA%\Lexy\projects.json`)

```json
{ "version": 1, "lastOpen": "C:\\Users\\…\\Documents\\Lexy\\Thesis",
  "projects": [ { "path": "D:\\Papers\\Survey", "mainDocument": "survey.tex", "lastOpened": 1763020800000 } ] }
```

- Max 20 entries, newest first, deduplicated by case-insensitive path.
- Projects inside the default folder appear on Project Home even when absent from the list; the list only adds `lastOpened` and `mainDocument` for them.
- Unknown `version` or unreadable JSON: treated as empty and rewritten on the next change (the bad file is kept as `projects.json.bak`).

## OpenFile (frontend, `openFiles.ts` reducer)

| Field | Type | Rules |
|-------|------|-------|
| path | relative path | Key |
| savedText | string | Text last read or written on disk |
| dirty | bool | Editor text differs from `savedText` |
| diskChanged | bool | Watcher reported a change while dirty; shows the "Reload / Keep mine" notice |

The editor's `EditorState` per path is held in `Editor.tsx` (R7), not in React state.

Reducer state: `{ files: Map<path, OpenFile>, current: path | null, main: path | null }`.
Events: `opened`, `edited`, `saved`, `switched`, `diskChanged`, `reloaded`, `renamed(from, to)`, `deleted(path)`, `mainSet(path)`.
Rules: renaming a folder renames every open file under it; deleting the current file switches to the main document; the main document can't be closed.

## Compile request (per compile)

| Field | Type | Rules |
|-------|------|-------|
| main | relative path | Must equal the project's main document |
| buffers | `{ path, text }[]` | Dirty open files only (includes main if dirty); each ≤ 10 MiB; editable extensions only |

Build folder key stays `hash(absolute main path)`, so existing build folders and PDF export (F-045) keep working.
