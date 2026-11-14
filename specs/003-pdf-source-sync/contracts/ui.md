# Contract: UI (003)

- **PDF → source**: double-click on a page → `sync_to_source` → open the file if needed, put the cursor at line start, scroll it into view, focus the editor, flash the line for 1 s. External file → status "Text is in <name>". No match → nothing.
- **Source → PDF**: Ctrl+J or View → "Show in PDF" → `sync_to_pdf` for the current file and line → scroll the spot into view (centered), show a 1 s translucent box. No PDF → status "Compile first". No match → "No PDF location for this line".
- **Zoom**: View group "Zoom": Zoom out, Fit width, Zoom in; Ctrl+wheel over the preview; Ctrl+= / Ctrl+- / Ctrl+0 while the preview is focused. A label shows "Fit" or "125 %". Kept across updates and restarts.
- **Failure note**: when the latest compile failed and an older PDF is shown, a thin bar above the preview reads "Preview is from the last successful compile", with "Show problems".
- **Inline problems**: gutter dot plus a line underline (error: danger color, warning: warn color), message on hover; markers are set per open file and cleared on the next result.
- **Problems list**: log drawer tabs "Problems (N)" | "Log". Each row shows an icon, `file:line` and the message; Enter or click jumps (opening the file). Rows without a line aren't links.
- No dialogs; nothing steals focus during live preview. Works at 800x600 and in dark mode.
