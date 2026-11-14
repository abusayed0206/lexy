# Contract: Writer UI and compile result

## Compile result (frontend ↔ future Rust `compile_document`)

M1 implements this as a frontend stub in `src/compile.ts`. M3 must return the same shape from Rust (serde camelCase) so the writer does not change.

```ts
type CompileResult = {
  ok: boolean;
  summary: string;        // one line, operational copy, e.g. "PDF ready" / "Compilation is not available yet"
  log: string;            // raw log text, may be empty
  pdfPath: string | null; // absolute path of the produced PDF when ok
};

function compile(source: string): Promise<CompileResult>;
```

M1 stub returns `{ ok: false, summary: "Compilation is not available yet", log: "Lexy cannot compile in this build. Compilation arrives in a later milestone.", pdfPath: null }`.

The promise rejects only on unexpected failure; the writer treats a rejection as `ok: false` with the error text as summary and log.

## Command strip

| Control | Kind | Accessible name | Tooltip | Shortcut | Enabled when |
| --- | --- | --- | --- | --- | --- |
| Compile | text button | "Compile" | "Compile" | none (undecided Ctrl+B/F5) | status ≠ compiling |
| Logs | icon toggle (`aria-pressed`) | "Show logs" / "Hide logs" | same | Ctrl+L | always |
| Status | text, `role="status"`, `aria-live="polite"` | — | — | — | always |

## Panes and drawer

| Region | Landmark / label | Content |
| --- | --- | --- |
| Editor | `<textarea aria-label="LaTeX source">` | monospace, no spellcheck |
| Preview | `<section aria-label="PDF preview">` | blank state "No PDF yet"; on error "Compile failed. Open log." with a button that opens the drawer |
| Log drawer | `<section aria-label="Compile log">` | summary line, then raw log in `<pre>`, "Copy log" button |

Focus order: Compile → Logs → editor → preview action (if shown) → drawer controls.

## Status labels

| status | Label |
| --- | --- |
| idle | Idle |
| dirty | Changed |
| compiling | Compiling |
| ready | PDF ready |
| error | Compile failed |
