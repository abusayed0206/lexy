# Quickstart: validate Git integration (006)

Prereqs: Git for Windows on PATH; for C, GitHub CLI and a GitHub account. Run `npm run tauri dev`.

Each batch is validated once, after all its features are built:

```powershell
cd src-tauri; cargo test git; cd ..; npm test
```

Rust tests use real `git` in temp folders (and a local bare repo as remote for C); they print "skipping" without git.

## A. Local history
1. New project → Git tab says "No history yet" → Start version history → `.gitignore` exists, History has "Start Lexy project".
2. Edit main `.tex` (don't save), type "Chapter 1", Ctrl+Enter → file saved, "Committed: Chapter 1", "Nothing to commit", sidebar badge gone.
3. Fresh Git config without user.name → commit asks name/email once.
4. Add a 60 MB file → commit warns; "Ignore them" adds it to `.gitignore`.
5. Bangla file name (`অধ্যায়.tex`) appears correctly and commits.

## B. Viewing & restore
1. Change two lines, delete a file → panel lists M and D; selecting shows the two lines red/green; CRLF-only change shows no diff.
2. Replace an image → "Binary file changed (old → new)".
3. Make 3 commits → History newest first; select first, View `main.tex`, Restore this file → editor shows old text, panel shows 1 change.
4. Restore whole project → confirm → files match; later commits still in History.

## C. Remote
1. Publish to GitHub (private) → browser sign-in if needed → link shown; repo has the commits.
2. Commit → "1 to push" → Push → online.
3. Second clone (`git clone` elsewhere) pushes a change → Push in Lexy says "Pull first" → Pull → editor reloads, "Pulled 1 commits".
4. Conflicting edit on the same line → Pull → conflict listed and badged → Keep theirs → Commit → clean. Repeat and Cancel pull → pre-pull state.
5. Pull with uncommitted edits → refused, asks to commit first. Disconnect network → Push says it could not reach the server.
6. Read-only second window → mutating buttons disabled.

Record runs in `docs/TRACKER.md` Verification Log.
