# Contract: UI (feature 007)

Follows `docs/DESIGN.md`, including its "Windows design alignment" section (research R15). All copy is sentence case. Every action below is registered in `src/actions.ts` and appears in the command palette with its shortcut.

## Shortcuts (new)

| Keys | Action | Notes |
|---|---|---|
| Ctrl+Space | Show suggestions | CodeMirror default |
| Shift+Alt+F | Tidy indentation | one undo step |
| F7 | Check grammar | first use asks to turn it on |
| Ctrl+Shift+P | Command palette | |
| Ctrl+Shift+F | Find in project | |
| Ctrl+Shift+O | Show outline | sidebar opens on Outline |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab | loops |
| Ctrl+W, Ctrl+F4 | Close tab | unsaved → existing Save / Don't save / Cancel |
| Ctrl+Shift+PageUp / PageDown | Move tab left / right | |
| Ctrl+Shift+[ / ] | Fold / unfold | CodeMirror default |
| F11 | Focus mode | F11 or Esc leaves |
| F6 / Shift+F6 | Next / previous pane | ribbon → sidebar → editor → PDF → drawer |
| Ctrl+Alt+M | New note on selection | Word precedent |
| Ctrl+, | Settings | |

No conflicts with DESIGN.md's list (Ctrl+Shift+E, Ctrl+Shift+G, Ctrl+Shift+K, Ctrl+J, Ctrl+L stay).

## Status bar (right of the existing status)

"1,234 words" or "56 of 1,234 words" with a selection; "NORMAL" / "-- INSERT --" / "VISUAL" when Vim is on.

## Editor

- Suggestions popup: label, detail on the right ("Author · 2021", label context, signature), type icon; Enter/Tab accept, Esc closes.
- Spelling: dotted underline (`--warn-text`, plus underline style so color isn't the only signal); right-click → up to 8 suggestions, "Add to dictionary", "Ignore"; never on commands, math, labels, keys, URLs, comments, or uncovered scripts.
- Grammar: wavy underline in the accent color; hover shows message + replacements as buttons.
- Hover math: popup after 300 ms with KaTeX output or "Can't render: <message>".
- Fold markers in the gutter; folded text shows "…".

## Editor tabs (`EditorTabs.tsx`)

Strip above the editor, height 32 px, `role="tablist"`. Tab = file name + unsaved dot + close button (`aria-label="Close <name>"`, visible on hover/focus and always on the active tab). Overflow: strip scrolls; ‹ › buttons appear. Context menu: Close, Close others, Copy path, Reveal in sidebar. Hidden in focus mode.

## Sidebar tabs

Files | Outline | Notes (`role="tablist"` above the tree). Outline rows: indent by depth, icon per kind, title truncated with ellipsis and full text in `title`; Enter/click jumps; "No headings yet" empty state. Notes rows: quote (1 line), body (2 lines), date; buttons Resolve / Reopen / Delete; "Show resolved" toggle; detached notes show "Text was removed".

## Command palette (`CommandPalette.tsx`)

Centered overlay at the top, width min(600 px, 90 %), input "Type a command", list with title, group and shortcut; ↑/↓ moves, Enter runs, Esc closes; "No matching commands".

## Find in project (`ProjectSearch.tsx`)

Panel in the sidebar position (replaces the tree while open): find field, replace field, toggles Match case (Alt+C), Whole word (Alt+W), Regular expression (Alt+R); results grouped by file with count and line previews (match highlighted); Enter on a result opens it; "Replace all" shows "Replaced 12 matches in 3 files. Press Ctrl+S to save." (InfoBar, success). Invalid regex → inline error under the field.

## Focus mode

Hides ribbon, tabs, sidebar, drawer (and PDF if the setting is on); an InfoBar-free top edge; a small "Leave focus mode (F11)" button appears on pointer move near the top.

## Insert → Citation (`ribbon/CitationDialog.tsx`)

Search field (author, title, year, key), multi-select list, buttons "Insert" (primary) and "Cancel"; "Add by DOI…" link opens `DoiDialog`. No `.bib` → "No bibliography yet" with "Create references.bib".

## Add by DOI (`ribbon/DoiDialog.tsx`)

Field "DOI", "Look up" → preview of the BibTeX (read-only), target `.bib` combo, buttons "Add" / "Cancel". Note under the field: "Only the DOI is sent to doi.org." Errors inline: "Could not fetch this DOI".

## Insert → Image

File picker (images); or drop on the editor. Result: file in `figures/`, figure block at the cursor/drop point, `graphicx` added if missing; InfoBar "Copied photo.png to figures/". Non-images dropped on the editor import like the sidebar, without a figure.

## New project → template gallery (`TemplateGallery.tsx`)

In the New project prompt: name field + a list of templates (Blank, Article, Report, Letter, CV, Beamer) with one-line descriptions; Blank selected by default.

## Review tab (new ribbon tab, access key R)

Check grammar (F7), New note (Ctrl+Alt+M), Show notes, Compare with last commit, Compare with…, Export PDF with notes.

## Compare view (`CompareView.tsx`)

Replaces the editor read-only with a header "Comparing with <commit subject · date>" and "Close comparison"; insertions highlighted (`--added-bg` + underline), deletions struck through (`--removed-bg` + line-through); file picker when several files differ.

## File → Export

Word document (.docx), Web page (.html). First use: dialog "Export needs Pandoc (35 MB). Download and install it?" buttons "Download" (primary) / "Cancel"; then progress in an InfoBar. Done: InfoBar "Exported Thesis.docx" with "Open" and, when warnings exist, "3 parts were approximated" with "Show details".

## Settings (`SettingsDialog.tsx`, File → Settings, Ctrl+,)

Full-window panel, single column ≤ 1000 px, sections (body strong headers): **Appearance** (Theme combo: Use system setting / Light / Dark; Editor font size), **Editing** (Vim keys toggle, Auto-save toggle + delay, Spelling toggle + language), **Preview** (Live preview delay, Hide PDF in focus mode), **Grammar** (toggle, server URL, note "Checked text is sent to this server"), **Files** (Image folder), **About** (version, logs folder link). Changes apply immediately; Esc or "Back" closes.

## Sidebar file menu (US5)

Duplicate, Copy, Paste (Paste only when something was copied in this window; disabled in read-only windows). File → History (projects without Git): list of snapshots for the current file (time, size) with "Compare" and "Restore"; projects with Git show the Git history instead.

## Windows alignment (existing UI)

- Dialog buttons: primary first (left, accent, Enter), secondary, Cancel last (right, Esc). Applies to `ProjectDialogs.tsx`, `ribbon/*Dialog.tsx`, `GitPanel.tsx` prompts, `SetupScreen.tsx`.
- `InfoBar.tsx` replaces ad-hoc bars: project folder missing (error, not closable), stale preview (warning), Bangla font offer (default), read-only window (warning), outside-change Reload / Keep mine (warning).
- High contrast: in `forced-colors: active`, borders use `CanvasText`, focus rings `Highlight`, selection `Highlight`/`HighlightText`; no information carried by background color alone.
