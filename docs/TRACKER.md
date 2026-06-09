# Lexy Feature Tracker

Last updated: 2026-06-10

This tracker is the source of truth for implementation status. Any contributor working here for the first time must read this file, `docs/PLAN.md`, and `docs/DESIGN.md` before making changes.

## Status Legend

| Status | Meaning |
| --- | --- |
| Done | Implemented and verified. |
| In Progress | Work exists but is incomplete or not fully verified. |
| Not Started | No meaningful implementation yet. |
| Blocked | Cannot proceed without a decision, dependency, or access. |
| Manual | Manually added idea or requirement awaiting triage. |

## Current Implementation Snapshot

| Area | Status | Evidence |
| --- | --- | --- |
| Tauri 2 scaffold | Done | `src-tauri`, `tauri.conf.json`, `package.json` exist. |
| React/Vite scaffold | Done | `src`, `vite.config.ts`, React dependencies exist. |
| Lexy product identity | In Progress | Package/app name is `lexy`; README and UI still use template copy. |
| Minimal LaTeX writer UI | In Progress | Initial dependency setup screen exists; editor/preview still not implemented. |
| Rust LaTeX commands | In Progress | Initial setup and environment detection commands exist; compile command not implemented. |
| MiKTeX integration | In Progress | Detection and initial unattended setup flow exist; VM validation still required. |
| Strawberry Perl integration | In Progress | Detection and silent MSI setup flow exist; portable option not implemented. |
| Windows installer polish | Not Started | Tauri bundling is enabled, but no installer strategy is configured. |

## Feature Tracker

| ID | Feature | Priority | Status | Owner | Verification | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| F-001 | Replace template README with Lexy onboarding | P0 | Done | Codex | File review | Links plan, design, tracker, and setup commands. |
| F-002 | Remove default Tauri greeting UI | P0 | Done | Codex | `npm run build` | Replaced by initial setup screen. |
| F-003 | Set app metadata and window title to Lexy | P0 | In Progress | Codex | `npm run tauri dev` | HTML title updated; Tauri/package metadata still needs polish. |
| F-004 | Minimal split editor/preview layout | P0 | Not Started | Unassigned | Browser visual check | Editor left, preview right, compact command strip. |
| F-005 | Starter LaTeX document | P0 | Not Started | Unassigned | App launch | Load a minimal article when no file is open. |
| F-006 | Manual compile button | P0 | Not Started | Unassigned | Compile smoke test | Calls Rust backend; disabled while compiling. |
| F-007 | Debounced auto compile toggle | P1 | Not Started | Unassigned | UI interaction test | Must avoid overlapping compile jobs. |
| F-008 | Compile status indicator | P0 | Not Started | Unassigned | UI state review | Idle, dirty, compiling, success, error. |
| F-009 | Collapsible log panel | P0 | Not Started | Unassigned | Compile failure test | Opens automatically on error. |
| F-010 | Open `.tex` file | P0 | Not Started | Unassigned | Manual file test | Use Tauri dialog/filesystem path flow. |
| F-011 | Save current `.tex` file | P0 | Not Started | Unassigned | Manual file test | Preserve user content exactly. |
| F-012 | Save as `.tex` file | P0 | Not Started | Unassigned | Manual file test | Validate extension but do not fight user intent. |
| F-013 | Dirty state tracking | P0 | Not Started | Unassigned | UI state test | Warn before destructive close/open. |
| F-014 | Recent files | P2 | Not Started | Unassigned | App relaunch | Store in app config data. |
| F-015 | Rust workspace service | P0 | Not Started | Unassigned | Rust tests | Read/write documents through typed commands. |
| F-016 | Rust compiler service | P0 | Not Started | Unassigned | Rust tests + smoke test | Runs `latexmk` with captured stdout/stderr. |
| F-017 | Compile job cancellation/queue | P1 | Not Started | Unassigned | Rapid edit test | New compile must not corrupt outputs. |
| F-018 | PDF preview refresh | P0 | Not Started | Unassigned | Successful compile test | Choose asset URL/viewer strategy. |
| F-019 | MiKTeX detection | P0 | In Progress | Codex | Machine with MiKTeX | Detects `miktex`; package behavior check still needed. |
| F-020 | Strawberry Perl detection | P0 | In Progress | Codex | Machine with Perl | Detects `perl --version`. |
| F-021 | `latexmk` detection | P0 | In Progress | Codex | Machine with MiKTeX | Detects `latexmk --version`. |
| F-022 | Dependency setup screen | P0 | In Progress | Codex | Fresh machine UI test | Initial screen exists; needs browser and VM validation. |
| F-023 | App-managed dependency install | P0 | In Progress | Codex | Fresh VM test | MiKTeX per-user flow and Perl MSI flow implemented; no VM validation yet. |
| F-024 | Dependency hash verification | P0 | In Progress | Codex | Unit/integration test | Verification hook exists; pinned hashes are not configured yet. |
| F-025 | Setup progress reporting | P1 | In Progress | Codex | Setup test | Rust emits `setup-progress`; needs live setup validation. |
| F-026 | Setup log access | P1 | Not Started | Unassigned | Failure test | User can open/copy setup logs. |
| F-027 | Tauri capabilities for shell/files | P0 | Not Started | Unassigned | Capability review | Keep command surface minimal. |
| F-028 | Windows installer target decision | P0 | Blocked | Product | Decision recorded | NSIS vs MSI vs both. |
| F-029 | Bundle dependency resource decision | P0 | Blocked | Product/Engineering | Decision recorded | Bundle installers or download on demand. |
| F-030 | WebView2 installer mode decision | P1 | Blocked | Engineering | Build review | Tauri supports download/offline/fixed runtime modes. |
| F-031 | App update strategy | P2 | Not Started | Unassigned | Release plan review | Decide after MVP installer works. |
| F-032 | Keyboard shortcuts | P1 | Not Started | Unassigned | Manual shortcut test | See `docs/DESIGN.md`. |
| F-033 | Minimal settings screen | P2 | Not Started | Unassigned | UI review | Dependency paths, auto compile, theme. |
| F-034 | Accessibility pass | P1 | Not Started | Unassigned | Keyboard/display scaling test | Required before first public build. |
| F-035 | Fresh Windows VM smoke test | P0 | Not Started | Unassigned | VM checklist | No MiKTeX/Perl preinstalled. |
| F-036 | Release checklist | P1 | Not Started | Unassigned | File review | Build, install, setup, compile, uninstall. |

## Manual Feature Intake

Add new ideas here first. During triage, either move them into the feature tracker with an ID or mark them rejected with a reason.

| Date | Author | Manual Feature | Why It Matters | Triage |
| --- | --- | --- | --- | --- |
| 2026-06-10 | Codex | Choose installer target: NSIS, MSI, or both. | Affects packaging, enterprise install behavior, and setup UX. | Needs decision |
| 2026-06-10 | Codex | Choose editor engine: textarea, CodeMirror, or Monaco. | Affects app weight and LaTeX editing capability. | Default to textarea for MVP |
| 2026-06-10 | Codex | Choose PDF preview strategy. | Affects file permissions, refresh behavior, and app size. | Needs prototype |
| 2026-06-10 | Codex | Decide whether to switch Strawberry Perl from MSI to portable. | Portable may better match no-GUI app-managed setup, but asset URL and extraction flow need confirmation. | Needs decision |

## Decision Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-06-10 | Use Tauri 2 + React + Rust as the app foundation. | Current scaffold already uses this stack and it fits a small Windows desktop app. |
| 2026-06-10 | Treat `PLAN_draft.md` as historical input, not the source of truth. | The draft includes useful direction but also unsafe installer assumptions and template-level snippets. |
| 2026-06-10 | Require Context7 checks for external framework/package docs before implementation decisions. | User requested updated docs; packaging and permissions change over time. |
| 2026-06-10 | Use MiKTeX standalone setup utility with a local basic package repository for initial setup. | Official MiKTeX deployment docs recommend `miktexsetup_standalone` for unattended deployment. |

## Verification Log

| Date | Command/Test | Result | Notes |
| --- | --- | --- | --- |
| 2026-06-10 | Repository inspection | Passed | Confirmed scaffold and draft plan. |
| 2026-06-10 | Context7 Tauri docs query | Passed | Confirmed Windows build command, resources, sidecars, shell capabilities. |
| 2026-06-10 | Official MiKTeX and Strawberry Perl docs review | Passed | Confirmed MiKTeX setup utility flow and Strawberry MSI/portable release types. |
