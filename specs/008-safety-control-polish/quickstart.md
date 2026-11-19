# Quickstart: Safety and Control Polish (validation)

Automated gates first, then the manual scenarios in the native window (`npm run tauri dev`). Record results in the `docs/TRACKER.md` Verification Log.

## Automated gates

```powershell
cd src-tauri; cargo test
npm test
npx tsc --noEmit
npm run build
```

Expected: all pass. The real stop test (`compile_stop_kills_latexmk_tree`) prints "skipping" when MiKTeX/latexmk/Perl are missing.

## Scenario A: crash recovery (US1, SC-001/002)

1. Open a project and type a sentence into `chapters/intro.tex` without saving. Wait 12 s.
2. End `lexy.exe` in Task Manager.
3. Check that `%LOCALAPPDATA%\Lexy\Recovery\` holds one JSON file for the project and that `intro.tex` on disk is unchanged.
4. Start Lexy. The project reopens with the InfoBar "Lexy found unsaved text … in 1 file."
5. Click **Restore all**. The sentence is back and the file shows as unsaved; Ctrl+Z returns to the disk text.
6. Ctrl+S, then close Lexy normally and start it again: no InfoBar, and the recovery folder for the project is empty.
7. Repeat steps 1–2, then change the file in another editor before step 4: the restore notice says the file changed on disk.
8. Open the same project in a second window (read-only): it shows no recovery InfoBar and writes nothing.

## Scenario B: stop a compile (US2, SC-004/005)

1. Put `\def\x{\x}\x` in the document body and press F5.
2. While "Compiling" shows, press **Stop** (or Shift+F5).
3. Within 2 s: status "Compile stopped", the previous PDF still on screen, and no `latexmk`, `perl` or `pdflatex` processes in Task Manager.
4. Remove the loop and press F5: the compile succeeds and the PDF updates.
5. With live preview on, type the loop and wait for "Compiling", keep typing, then press Shift+F5: nothing else compiles until the next edit.

## Scenario C: engine choice (US3, SC-006)

1. Layout → Engine → **LuaLaTeX**. Line 1 of the main document becomes `% !TEX TS-program = lualatex`; after the compile the menu shows "Last compile: LuaLaTeX (engine line)".
2. Ctrl+Z once: the line is gone.
3. Choose **XeLaTeX**, then **Automatic**: replaced in place, then removed; never two lines.
4. Home → Font → an installed font (adds `% !TEX program = xelatex`), then Layout → Engine → **pdfLaTeX**: the warning dialog appears with Cancel focused.
5. Show a chapter file and choose an engine: the main document changes, not the chapter.

## Scenario D: find in PDF (US4, SC-007)

1. Compile a 50-page document (for example the article template with repeated sections). Click the PDF, then press Ctrl+F.
2. Type a word that appears often: highlights appear within 1 s and the count reads "1 of N".
3. Enter / Shift+Enter step through matches and scroll them into view, wrapping at the ends.
4. Edit the source so the PDF recompiles: the search re-runs and the count updates.
5. Esc closes the bar and focus returns to the PDF; Ctrl+F in the editor still opens the editor's search.
6. Switch to the dark theme and a Windows contrast theme: highlights stay visible.
