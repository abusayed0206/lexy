# Data Model: Minimal Writer Shell

All state is in-memory frontend state. Nothing is persisted in M1.

## AppView (derived, in `App`)

| Condition | View |
| --- | --- |
| environment check pending | `checking` |
| check failed, or `environment.ready === false` | `setup` |
| `environment.ready === true` | `writer` |

Uses the existing `EnvironmentStatus` from `check_environment` / `start_initial_setup` (no change).

## Document (in `Writer`)

| Field | Type | Notes |
| --- | --- | --- |
| `source` | string | Initialized from the starter article (`src/starter.ts`). |

## CompileState (reducer in `Writer`)

| Field | Type | Notes |
| --- | --- | --- |
| `status` | `"idle" \| "dirty" \| "compiling" \| "ready" \| "error"` | Shown as text: Idle, Changed, Compiling, PDF ready, Compile failed. |
| `summary` | string \| null | Short line shown in status bar and top of drawer. |
| `log` | string | Raw log of the last compile attempt; empty before the first. |
| `pdfPath` | string \| null | Always null in M1; set by M3 on success. |

### Transitions

| From | Event | To | Side effect |
| --- | --- | --- | --- |
| idle, ready, error | `edit` | dirty | — |
| dirty | `edit` | dirty | — |
| compiling | `edit` | compiling | edit is kept; status updates on result |
| any except compiling | `compileStart` | compiling | Compile button disabled |
| compiling | `compileDone(ok)` | ready | store `summary`, `log`, `pdfPath` |
| compiling | `compileDone(error)` | error | store `summary`, `log`; **open drawer** |

Validation: `compileStart` is ignored while `compiling` (also enforced by the disabled button).

## LogDrawer (in `Writer`)

| Field | Type | Notes |
| --- | --- | --- |
| `open` | boolean | `false` on start; toggled by button and Ctrl+L; forced `true` on error result. |
