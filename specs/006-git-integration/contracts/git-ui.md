# Contract: Git UI (006)

Follows `docs/DESIGN.md`: sparse, short operational copy, works at 800x600.

## Ribbon tab "Git" (after View)
Groups: **History** (Start version history | Commit, History) · **Online** (Publish to GitHub, Connect…, Push, Pull, Sync). Buttons disabled per state; read-only window disables all but History and Changes.

## Git panel (right of editor, toggled by the tab or Ctrl+Shift+G)
- Header line: state text — "No history yet" / "Nothing to commit" / "N changes" / "N to push · M to pull" / "Conflicts in N files" / "Part of the repository at <root>" / "Git for Windows is needed for version history" + link.
- **Changes**: message box + Commit (Ctrl+Enter in the box; Ctrl+Shift+K focuses it from anywhere); list of files with M/A/D/R/C letter; selecting shows the inline diff (removed red, added green, 3 lines context; binary: "Binary file changed (12 KB → 15 KB)").
- **History**: commits newest first (message, author, relative date via `relativeDate`, "N files"); loads 50 more on scroll end. Selected commit → file list → View / Compare with current / Restore this file; "Restore whole project to this point" with confirm.
- **Conflicts** (when merging): per file Keep mine / Keep theirs / Mark resolved; "Cancel pull".
- Results: one line "Committed: <msg>", "Pushed N commits", "Pulled N commits", errors in plain words (e.g. "Someone else pushed changes. Pull first." with a Pull button; "Could not reach <host>. Your commits are safe here.").

## Sidebar
Changed files get a letter badge (M/A/D/C) at the row end, from the same `GitState`.

## Dialogs (existing `ProjectDialogs`)
Identity (name, email) once; Publish (name default = folder, Private checked); Connect (URL); large-file warning (Ignore them / Commit anyway / Cancel); restore and unsaved-file confirms use `useChoice`.

## Keyboard
Ctrl+Shift+G panel, Ctrl+Shift+K commit message, Ctrl+Enter commit; all buttons tabbable.
