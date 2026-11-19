# Contract: UI (spec 008)

Copy follows `docs/DESIGN.md`: short, operational, sentence case, verb buttons, primary first, Cancel last.

## Stop compile (US2)

| Element | Rule |
| --- | --- |
| Stop button | Next to the compile status text; rendered only while status is `compiling`; label "Stop", accessible name "Stop compile (Shift+F5)", tooltip the same |
| Shortcut | Shift+F5 in the Writer's capture-phase listener; ignored while a dialog is open or nothing compiles |
| Status | `stopped` → label "Compile stopped"; tooltip `"<Engine> · Compile stopped"` when the engine is known |
| Log drawer | Not opened by a stopped result |
| Leaving a project | InfoBar (warning): "The PDF was not updated: the compile was stopped." The window stays open once, as for a failed export |
| Read-only window | No Stop button (read-only windows don't compile) |

## Crash recovery (US1)

| Element | Rule |
| --- | --- |
| InfoBar on project open | Severity informational: "Lexy found unsaved text from your last session in N file(s)." Buttons: **Restore all**, **Discard all**, **Review…** |
| Review dialog | Title "Unsaved text from your last session"; one row per file: path, "saved <relative time>", notes "changed on disk since" / "file no longer exists"; row buttons **Restore**, **Discard**; dialog buttons **Done** (closes; anything left stays offered next time) |
| After Restore | The file opens with the text as an unsaved change; InfoBar "Restored unsaved text in <file>. Press Ctrl+Z to undo, Ctrl+S to keep it." plus, when `diskChanged`, " This file changed on disk since." |
| Discard all | Destructive: confirmation dialog "Discard unsaved text in N file(s)? This can't be undone." with **Discard** / **Cancel**, Cancel focused |
| Write failure | One InfoBar per session (warning): "Lexy couldn't keep a recovery copy of your unsaved text. Save often." |
| Read-only window | Nothing shown |

## Engine choice (US3)

| Element | Rule |
| --- | --- |
| Ribbon | Layout tab, menu button "Engine" (icon + label; icon-only below the ribbon container breakpoint) |
| Menu items | Radio group: **Automatic**, **pdfLaTeX**, **XeLaTeX**, **LuaLaTeX**; the current choice checked; a separator; a disabled info line "Last compile: <Engine> (<reason>)" where reason is "engine line", "<package> package", "default" or "Bangla text" |
| Palette | "Engine: Automatic", "Engine: pdfLaTeX", "Engine: XeLaTeX", "Engine: LuaLaTeX" |
| Font warning | Choosing pdfLaTeX with a system/project font: dialog "This font needs XeLaTeX or LuaLaTeX. Use pdfLaTeX anyway?" **Use pdfLaTeX** / **Cancel**, Cancel focused |
| Effect | One undo step on the main document (even when another file is shown); live preview recompiles as for any edit |
| Read-only window | Menu disabled; palette commands hidden |

## Find in PDF (US4)

| Element | Rule |
| --- | --- |
| Open | Ctrl+F while the PDF scroller has focus; ignored when no PDF is shown |
| Bar | Overlays the top-right of the preview; text field (label "Find in PDF"), count text, **Previous** / **Next** icon buttons (names "Previous match (Shift+Enter)" / "Next match (Enter)"), **Close** (name "Close (Esc)") |
| Count | "n of m", "No results" when the query has none, empty when the query is empty; in an `aria-live="polite"` region |
| Keys | Enter → next, Shift+Enter → previous (wrapping); Esc → close and focus the PDF scroller |
| Highlights | All matches `--find-match`, current `--find-current`; both ≥ 3:1 against the page white in light and dark themes; `forced-colors`: `Mark` / `Highlight` |
| Scrolling | The current match is scrolled into view (centered when off-screen); typing jumps to the first match at or after the current scroll position |
| Recompile | Search re-runs; the current match moves to the nearest match at or after the old page/top |
