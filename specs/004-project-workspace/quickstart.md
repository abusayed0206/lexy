# Quickstart: validating Project Workspace

## Prerequisites

- MiKTeX, latexmk and Perl installed through Lexy setup (needed for the compile scenarios).
- `npm install`, then `npm run tauri dev`.

## Automated checks

```powershell
cd src-tauri; cargo test project     # path gate, CRUD, main detection, projects.json, lock
cd src-tauri; cargo test compile_end_to_end_when_tools_are_installed   # gains the overlay case
npm test                              # ProjectHome, Sidebar, openFiles reducer, Writer multi-file
```

Key Rust cases (see [contracts/backend-commands.md](contracts/backend-commands.md)):

- `resolve_in_project` rejects `..\x`, `C:\x`, `\\server\x`, `CON`, and a junction inside the project that points outside it.
- Main detection: one `\documentclass` file means it is main; two candidates means null plus both listed; a commented-out `%\documentclass` doesn't count.
- Overlay compile: `main.tex` does `\input{chapters/intro}` and `\includegraphics{fig.png}`. An unsaved buffer for `chapters/intro.tex` appears in the PDF, the file on disk is unchanged, and `fig.png` is not copied into the build folder.
- A second `open_project` on a locked root returns `readOnly: true`.

## Manual scenarios (map to spec user stories)

1. **US1**: Delete `projects.json`, launch, and Project Home lists existing `Documents\Lexy\*` folders. New project "Thesis" creates `Thesis\Thesis.tex` and opens it. Quit and relaunch: Thesis reopens directly.
2. **US1**: Open folder… on a folder outside Documents. It appears on Project Home with its location. Rename that folder in Explorer, and the row shows "Missing".
3. **US2**: New folder `chapters`, new file `chapters\intro.tex`; type in it, switch to main and back. Text, cursor and Ctrl+Z history are intact and the unsaved dot is shown.
4. **US2**: Drag `fig.png` from Explorer onto `chapters` and it is copied in. Drag it again and you get Replace / Keep both / Skip.
5. **US2**: Edit `chapters\intro.tex` in Notepad. Lexy's clean copy reloads within 2 s. Repeat while Lexy has unsaved edits and the "Reload / Keep mine" bar appears.
6. **US3**: With intro open and unsaved, wait for live preview. The PDF shows the change and the file on disk is unchanged. Press F5: both files are saved, the main document is compiled.
7. **US3**: Add a second top-level `.tex` with `\documentclass`, reopen the project, and you are asked to choose the main document once.
8. **US4**: Edit two files, close the window, and get one prompt listing both. Save all, then the PDF appears beside the main `.tex`.
9. **Edge**: Run a second Lexy and open the same project: read-only bar, Save disabled.
10. **Layout**: Resize to 800x600 with the sidebar open; nothing overlaps; Ctrl+Shift+E hides it.
