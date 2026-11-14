# Quickstart: validate 003

Prereqs: MiKTeX + latexmk installed (Lexy setup done). Run `npm run tauri dev`.

Automated, once per batch:

```powershell
cd src-tauri; cargo test; cd ..; npm test; npm run build
```

The real e2e (`sync_round_trip_when_tools_are_installed`) prints "skipping" without MiKTeX.

## A. Compile data
1. Compile a 3-file project (main + `chapters/intro.tex` via `\input`): the build folder has `.lexy-shown\<stem>.pdf` and `.synctex.gz`.
2. Put `\foo` on intro line 5 and `\ref{nope}` in main: the result lists an error at `chapters/intro.tex:5` and a warning in main with the right line.

## B. Jumps
1. Double-click a paragraph on page 2 → the editor lands on its line (flash). Double-click intro text → `intro.tex` opens at the line. Double-click a class-generated header → "Text is in article.cls".
2. In intro, put the cursor on a paragraph, press Ctrl+J → the preview scrolls there with a box. Cursor on a comment line → the next output, or the status message.
3. Make the document fail, then double-click → it still jumps, using the last good PDF.
4. XeLaTeX document (Bangla project from spec 005): both directions work.

## C. Feedback UI
1. Zoom to 150 %, scroll to page 3, type → after the update the view is still at 150 % and page 3.
2. Introduce an error → the old PDF stays with the note; inline marker on the line; the drawer does not open (live). Press F5 → the drawer opens on Problems; clicking a row jumps.
3. Fix it → the marker and note disappear.
4. 800x600, light and dark: the controls fit and the markers are readable.

Record runs in `docs/TRACKER.md` Verification Log.
