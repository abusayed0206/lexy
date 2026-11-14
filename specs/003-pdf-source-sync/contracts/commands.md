# Contract: commands (003)

| Command | Args | Result | Notes |
|---------|------|--------|-------|
| `compile_project` (changed) | `{ main, buffers }` (unchanged) | `CompileResult` + `problems` | adds `-synctex=1` and `-max-print-line=1000`; on success copies the PDF and SyncTeX file into the shown slot and returns the slot PDF path |
| `sync_to_source` | `{ main, page, x, y }` | `SyncTarget \| null` | `synctex edit` on the shown slot of `main`'s build folder; 5 s timeout |
| `sync_to_pdf` | `{ main, file, line }` | `PdfSpot \| null` | `synctex view`, trying the recorded-name candidates (research R2) |

Neither lookup is an error when nothing matches; it returns `null`. Real failures (no slot yet, `synctex.exe` missing) return `Err(String)`, and the UI shows "Compile first" or "Click-to-jump needs a fresh compile".
