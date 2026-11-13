# Quickstart: validate the Minimal Writer Shell

## Prerequisites

- Windows with Node and Rust toolchain; `npm install` done.
- For scenarios 1–5: MiKTeX, latexmk and Perl detectable (setup screen shows all Installed).
- For scenario 6: a machine/user where one tool is missing (e.g. rename Perl off `PATH` temporarily).

## Build check

```powershell
npm run build
```

Expected: typecheck and Vite build pass with no errors.

## Run

```powershell
npm run tauri dev
```

## Scenarios

1. **Opens to writer** — Launch. Expect a brief "Checking tools", then the writer: command strip, editor with the starter article (left), "No PDF yet" preview (right), drawer collapsed, status "Idle". No setup, landing or demo content. (US1, FR-001–004, FR-012)
2. **Dirty state** — Type one character. Status becomes "Changed". (FR-006, FR-007)
3. **Compile stub + auto-open log** — Click Compile. Status shows "Compiling", Compile is disabled, then status "Compile failed"; drawer opens by itself with "Compilation is not available yet" above the raw log; preview says "Compile failed. Open log." (FR-008, FR-009, SC-005)
4. **Drawer controls** — Press Ctrl+L twice: drawer closes then opens. Click the Logs toggle: same. Click "Copy log", paste into Notepad: full log text. (FR-009)
5. **Layout and accessibility** — At the minimum 800x600 window, set Windows scaling to 100%, 125%, 150% in turn: no overlapping or clipped controls, editor still usable with drawer open. Hover the Logs icon: tooltip shows. Tab through: Compile → Logs → editor → … Inspect the accessibility tree: every icon button has a name. View in grayscale: every status distinguishable by text. (FR-010, FR-011, SC-002–004)
6. **Setup only when missing** — With a tool missing, launch: setup screen appears instead of the writer. Run setup (or restore the tool and click Recheck): writer appears without restarting. (US4)

## Done

All six scenarios pass; record the run in `docs/TRACKER.md` Verification Log and update F-004, F-005, F-008, F-009.
