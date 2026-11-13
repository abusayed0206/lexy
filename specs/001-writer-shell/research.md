# Research: Minimal Writer Shell

No NEEDS CLARIFICATION items remained in Technical Context. These are the design decisions made for M1.

## R1 — Editor engine

- **Decision**: Plain `<textarea>` with a monospace font, `spellCheck={false}`, `wrap="off"`.
- **Rationale**: Tracker manual intake already defaults to textarea for MVP; zero dependencies; native accessibility, undo and IME support.
- **Alternatives considered**: CodeMirror 6 (syntax highlighting, line numbers — adds weight; revisit when line numbers are needed), Monaco (far too heavy for the app's size goal).

## R2 — Where the compile stub lives

- **Decision**: A frontend function `compile(source): Promise<CompileResult>` in `src/compile.ts` that waits briefly and returns an error result "Compilation is not available yet".
- **Rationale**: M1 has no compiler. Defining the result shape now (matching the future Rust command) lets M3 replace one function body with `invoke("compile_document", …)` and nothing else changes. Adding a Rust stub command would add backend surface with no behavior.
- **Alternatives considered**: Disabled Compile button (makes Error state and auto-open drawer untestable in M1); Rust stub command (extra code, same outcome).

## R3 — View gating and the checking state

- **Decision**: `App` holds `environment` (null while checking). Render `Checking tools` while null, `SetupScreen` when `!ready` or the check failed, `Writer` when `ready`. After setup succeeds, `start_initial_setup` already returns a ready `EnvironmentStatus`, so the gate flips to the writer without a restart.
- **Rationale**: Reuses the existing commands and state; no new backend work.
- **Alternatives considered**: Router/library — unnecessary for three states.

## R4 — Compile status model

- **Decision**: A single `useReducer` over `{ status, message, log }` with events `edit`, `compileStart`, `compileDone(result)`. Drawer open state is separate `useState`; `compileDone` with an error also opens the drawer.
- **Rationale**: Transitions are few and need to be in one place so M3 can reuse them unchanged.
- **Alternatives considered**: Scattered `useState` calls (easy to desync Compiling/disabled), global store (rejected by PLAN rule "keep frontend state local").

## R5 — Testing approach

- **Decision**: No new test runner in M1. Verification = `npm run build` typecheck + the manual checklist in quickstart.md (layout at 800x600 and scaling is visual anyway).
- **Rationale**: The only logic is a five-state reducer; adding Vitest + config for it is more code than the logic. Revisit in M3 when compile parsing appears.
- **Alternatives considered**: Vitest (Vite-native, cheap to add later), Playwright against `tauri dev` (heavy for M1).

## R6 — 800x600 and display scaling

- **Decision**: Tauri `width/height` are logical pixels, so the CSS viewport stays 800x600 at 100/125/150%. Set `minWidth: 800, minHeight: 600` in `tauri.conf.json` so it can't shrink below that. Layout is a CSS grid: `auto` strip row, `1fr` panes row, `auto` drawer row; panes `minmax(0, 1fr)` each; drawer open height `min(40%, 220px)`; all sizes in rem/px, no viewport-scaled fonts.
- **Rationale**: Grid with `minmax(0, …)` prevents long lines from pushing the layout wider; capped drawer keeps the editor usable (edge case in spec).
- **Alternatives considered**: Resizable split (deferred by spec assumption).

## R7 — Copy log and Ctrl+L

- **Decision**: Copy via `navigator.clipboard.writeText` (works in WebView2 secure context, no Tauri clipboard plugin or capability). Ctrl+L via a `keydown` listener on `window` that calls `preventDefault`.
- **Rationale**: No new plugin or permission; matches "minimal capabilities".
- **Alternatives considered**: `@tauri-apps/plugin-clipboard-manager` (new dependency + capability for no gain).
