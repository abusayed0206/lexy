# Lexy Design Brief

Last updated: 2026-06-10

Lexy should feel like a fast native writing tool, not a web dashboard. The interface should be sparse, predictable, and optimized for repeated writing and compiling.

## Product Shape

Primary layout:

```text
Top command strip
Editor pane | PDF preview pane
Status/log drawer
```

The editor is the main object. Everything else supports writing, compiling, and understanding errors.

## Visual Direction

- Use a restrained neutral palette with one accent color.
- Avoid large hero sections, cards inside cards, decorative gradients, and marketing copy.
- Prefer thin separators, compact controls, and dense but readable spacing.
- Use 8px radius or less where rounded corners are needed.
- Keep typography practical: normal letter spacing, no viewport-scaled font sizes.
- Make the brand visible through title, icon, and polish, not large promotional text.

## First Screen

First launch has two possible states:

1. Dependencies valid: open directly to the writer.
2. Dependencies missing: show a compact setup state with dependency names, progress, and a single primary action.

Do not show a landing page. Do not explain the whole app on screen. Setup text should be operational and short.

## Main Writer UI

Required controls:

- New file.
- Open file.
- Save file.
- Compile.
- Auto compile toggle.
- Show/hide logs.
- Settings.

Use icons for common commands. Text labels are allowed when ambiguity would slow users down, especially for `Compile` and setup actions.

Editor expectations:

- Monospace font.
- Clear dirty state.
- Line numbers are optional for MVP but expected later.
- No text should overlap controls at narrow widths.
- Pane split should be resizable after MVP if it does not add complexity.

Preview expectations:

- Blank state when no PDF exists.
- Loading state during compile.
- Error state points users to logs.
- Successful compile refreshes without visible flicker where possible.

Log expectations:

- Collapsed by default unless compile fails.
- Preserve the raw LaTeX log, but show a concise summary first.
- Allow copying logs.

## Setup UX

Dependency setup should show:

- MiKTeX status.
- Strawberry Perl status.
- `latexmk` status.
- Current operation.
- Progress if installer/download reports progress.
- A link/button to open setup logs after failure.

Avoid silent blocking startup. If setup may take minutes, show progress immediately.

## Settings

Settings should be small and task-focused:

- Dependency paths and recheck button.
- Auto compile on/off and debounce interval.
- Compiler command options.
- Theme preference.
- App version and logs path.

Do not build a broad preferences system until required.

## Keyboard Shortcuts

Shortcuts (projects since feature 004):

- `Ctrl+N`: new file in the current folder (on Project Home: new project).
- `Ctrl+O`: open folder as a project.
- `Ctrl+S`: save all modified files in the project.
- `Ctrl+Shift+S`: save the current file as another name inside the project.
- `F5`: save all, then compile the main document (decided 2026-11-13; `Ctrl+B` is bold).
- `Ctrl+B` / `Ctrl+I` / `Ctrl+U`: bold / italic / underline the selection (editor only).
- `Ctrl+L`: toggle logs.
- `Ctrl+Shift+E`: show or hide the file sidebar (`Ctrl+B` stays Bold).

Shortcuts must not conflict with text editing expectations.

## Ribbon (2026-11-13, feature 002)

The compact command strip is replaced by a Word-style ribbon at the user's request (`specs/002-word-style-editor`). The LaTeX source stays visible; every ribbon action is a plain text edit.

- Tabs: File (New project, Open folder…, Recent projects, Project Home, New file, Save, Save as; was New, Open, Save, Save as before feature 004), Home (Font, Size, Bold/Italic/Underline, Bullets, Numbering, Styles), Insert (Equation, Table, Page break, Footnote), Layout (Margins, Size, Orientation), View (Files, Live preview, Compile now, Logs).
- File name, unsaved dot, status pill and Compile stay visible at the right of the tab row on every tab.
- At ≥ 900 px wide buttons show labels; below that they are icon-only with tooltips; below 820 px group captions hide. Nothing wraps or overlaps at 800 px.
- Shortcuts are a capture-phase handler so they beat CodeMirror's own bindings: Ctrl+L (select line) and Ctrl+I (select parent) are taken over by Lexy.
- Document-wide font, size, paper and margins are written into one marked "Lexy settings" block after `\documentclass`; Lexy never edits other preamble lines.
- Live preview recompiles about 1 s after typing stops, without saving. Live failures show "Preview failed" in the status; only F5/Compile failures open the log drawer.

## Projects (2026-11-13, feature 004)

Lexy works on folders, not single files (`specs/004-project-workspace`).

- Start: Project Home lists folders in `Documents\Lexy` plus recently opened folders elsewhere (newest first, location shown for outside ones, "Missing" rows can be removed). The last open project reopens directly.
- Writer layout: file sidebar | editor | PDF. Sidebar 220 px default, 160–400 px, resizable by drag or arrow keys, hidden with Ctrl+Shift+E or View → Files; it starts hidden below 900 px wide. Nothing overlaps at 800x600 with it open.
- The sidebar is a tree (arrow keys, Enter, F2 rename, Delete, Shift+F10 menu). The current file is highlighted, the main document has a "Main" badge, unsaved files (and folders containing them) show the unsaved dot. Build clutter and dot-files are hidden unless "Show hidden files" is on.
- Font, size and page settings always go to the main document, even when another file is shown.
- One prompt lists every unsaved file on close, Project Home or project switch.

## Bangla and other scripts (2026-11-14, feature 005)

- No setup for Bangla: documents using LaTeXbangla (or fontspec, polyglossia…) compile with XeLaTeX automatically. The status tooltip names the engine ("XeLaTeX · PDF ready").
- The editor shows every script with Windows' own fonts (Nirmala UI for Bangla/Devanagari, Segoe UI for Arabic/Hebrew, YaHei/Yu Gothic/Malgun Gothic for CJK). Right-to-left lines read right to left; LaTeX lines stay left to right.
- Bangla editing follows Windows text boxes: Left/Right step over a whole conjunct ("ক্ষে" is one step); Backspace removes one code point (ক্ষ → ক্), so a typist can correct the last keystroke.
- Errors name the cause in plain words: `Font "X" not found`, `Package "X" could not be found or installed (offline?)`.

## Accessibility And Responsiveness

- Every icon-only button needs an accessible name and tooltip.
- Focus order must follow visual order.
- Text must fit at 100%, 125%, and 150% Windows display scaling.
- The app should remain usable at 800x600, matching the current Tauri window baseline.
- Error states must not rely on color alone.

## Copy Style

Use short operational copy:

- "Compiling"
- "PDF ready"
- "MiKTeX missing"
- "Install dependencies"
- "Open log"

Avoid vague copy:

- "Something went wrong"
- "Magic setup"
- "Modern workspace"
- "Boost productivity"

## Manual Design Notes

Add manual design ideas below. Keep each note dated and move accepted work into `docs/TRACKER.md`.

| Date | Author | Note | Decision |
| --- | --- | --- | --- |
| 2026-06-10 | Codex | Keep MVP as split editor/preview with a compact command strip. | Superseded 2026-11-13 by the ribbon |
| 2026-11-13 | User | Word-style ribbon with fonts, equations, tables, margins and live preview. | Accepted (feature 002) |
