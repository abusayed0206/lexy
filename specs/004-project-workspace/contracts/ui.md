# Contract: Project UI

Follows `docs/DESIGN.md`: sparse native look, short operational copy, theme variables, 800x600 minimum.

## Project Home (`ProjectHome.tsx`)

- Header: "Lexy". Buttons: **New project** (Ctrl+N), **Open folder…** (Ctrl+O).
- List: one row per project with name, location (only when outside the default folder) and the relative date ("Today", "3 days ago"). Missing rows are greyed with the label "Missing" and a "Remove from list" action.
- Enter opens the focused row; arrow keys move between rows.
- New project: inline name field, default "Untitled", Enter to create, Esc to cancel. Invalid names show "Use a name without \ / : * ? \" < > |".
- Fallback notice when the default folder fell back to home (existing F-042 copy).
- Large folder: dialog "This folder is large. Open anyway?" with buttons Open / Cancel.

## Writer layout

```
[ Tabs · <project> / <file> [Main] •  · <compile status> · Compile ]
[ Ribbon panel ..................................................... ]
[ Sidebar | Editor                         | PDF preview            ]
```

As built: there is no separate status bar. The project, current file and Main badge sit in the ribbon's title area (tooltip: full path · Main: <main>.tex), next to the existing status pill. Short confirmations ("Applied to <main>.tex") show as a notice bar that hides after 2.5 s.

- Sidebar default width 220 px, resizable 160–400 px, collapsible with **Ctrl+Shift+E** (Ctrl+B stays Bold) and the View tab button "Files". It starts collapsed when the window is narrower than 900 px.
- Sidebar header: project name, buttons "New file", "New folder", and a "…" menu with "Show hidden files", "Open in Explorer" and "Project Home".
- Rows: folder disclosure, name, unsaved dot, "Main" badge on the main document. The current file is highlighted.
- Keyboard (tree pattern): Up/Down move, Right/Left expand or collapse, Enter opens, F2 rename (inline), Delete deletes with confirmation, Shift+F10 / context-menu key opens the context menu.
- Context menu: Open, Rename, Delete, New file here, New folder here, Set as main document (`.tex` only), Open in Explorer.
- Drop target: the folder row under the cursor is highlighted while dragging; dropping on a file row targets its folder; empty space targets the root.

## Prompts

| Situation | Text | Buttons |
|-----------|------|---------|
| Choose main document | "Which file is the main document?" plus a list of candidates | Use this / Cancel |
| No candidate at top level | "No main document found. Pick a .tex file in the sidebar and choose Set as main document." | OK |
| Delete | "Move <name> to the Recycle Bin?" | Delete / Cancel |
| No Recycle Bin | "This drive has no Recycle Bin. Delete <name> permanently?" | Delete permanently / Cancel |
| Import conflict | "<n> files already exist." | Replace / Keep both / Skip |
| Unsaved on close/switch/Home | "Save changes to these files?" plus the file list | Save all / Don't save / Cancel |
| File changed on disk while dirty (inline bar above editor) | "<name> changed on disk." | Reload / Keep mine |
| Read-only (bar) | "Open in another Lexy window. Read-only." | — |
| Project missing (bar) | "Project folder is missing." | Save as new project |
| Jump target in another file (from 003) | — | switches to that file |

## Shortcuts (changes)

| Key | Action |
|-----|--------|
| Ctrl+N | New project (Project Home) / New file in current folder (Writer) |
| Ctrl+O | Open folder… |
| Ctrl+S | Save all modified files |
| Ctrl+Shift+S | Save current file as… (inside the project) |
| Ctrl+Shift+E | Toggle sidebar (Ctrl+B stays Bold) |
| F5 | Save all, compile main document |

## Ribbon

- File tab: New project, Open folder…, Save, Save as, Project Home, Recent projects (submenu, max 10).
- Layout and font settings (Home/Layout tabs) always edit the main document (FR-017). When a sub-file is shown, the status bar briefly says "Applied to <main>.tex".
