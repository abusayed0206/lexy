# Lexy Initial Setup Process

Last updated: 2026-11-13

This document defines how Lexy checks and installs the LaTeX toolchain during initial setup. Users should not need to open MiKTeX, Strawberry Perl, PowerShell, or any setup wizard.

Sources checked:

- MiKTeX deployment guide: https://miktex.org/howto/deploy-miktex
- MiKTeX setup utility manual: https://docs.miktex.org/manual/miktexsetup.html
- Strawberry Perl releases: https://strawberryperl.com/releases.html
- Strawberry Perl GitHub release structure: https://github.com/StrawberryPerl/Perl-Dist-Strawberry/releases/download/SP_54221_64bit/strawberry-perl-5.42.2.1-64bit.msi
- Tauri 2 Context7 docs for Windows bundles, resources, sidecars, commands, and frontend progress events.

## Required Tools

Lexy needs these tools before it can compile a document:

| Tool | Why Lexy Needs It | Check |
| --- | --- | --- |
| MiKTeX | TeX distribution and package management. | `miktex --version` |
| latexmk | Build automation for LaTeX documents. | `latexmk --version` |
| Strawberry Perl | Perl runtime used by `latexmk` on Windows. | `perl --version` |

## Version Check Flow

Lexy checks in this order:

1. App-managed install locations under `%LOCALAPPDATA%\Lexy\Setup`.
2. Common per-user MiKTeX locations under `%LOCALAPPDATA%`.
3. Common Strawberry Perl locations such as `C:\Strawberry\perl\bin\perl.exe`.
4. Executables available on the current process `PATH`.

The backend command is:

```text
check_environment
```

It returns structured status for MiKTeX, `latexmk`, and Perl:

- installed or missing.
- detected version line.
- executable path if known.
- user-facing message.

## MiKTeX Install Flow

The official MiKTeX deployment guide recommends the standalone Windows setup utility for unattended deployment. The setup utility supports two relevant tasks:

- `download`: create a local package repository.
- `install`: install MiKTeX from that local repository.

Lexy follows that two-step model:

1. Download `https://miktex.org/download/win/miktexsetup-x64.zip`.
2. Extract `miktexsetup_standalone.exe`.
3. Create a local package repository:

```powershell
miktexsetup_standalone --verbose --local-package-repository <repo> --package-set=basic download
```

4. Install for the current user only:

```powershell
miktexsetup_standalone --verbose --local-package-repository <repo> --shared=no --modify-path=no --package-set=basic --user-install <install> --user-config <config> --user-data <data> install
```

Current Lexy paths:

| Item | Path |
| --- | --- |
| Setup root | `%LOCALAPPDATA%\Lexy\Setup` |
| Downloads | `%LOCALAPPDATA%\Lexy\Setup\downloads` |
| MiKTeX repository | `%LOCALAPPDATA%\Lexy\Setup\miktex-repository` |
| MiKTeX install | `%LOCALAPPDATA%\Lexy\Setup\MiKTeX` |
| MiKTeX config | `%LOCALAPPDATA%\Lexy\Setup\MiKTeXConfig` |
| MiKTeX data | `%LOCALAPPDATA%\Lexy\Setup\MiKTeXData` |

The install is intentionally `--shared=no` to avoid requiring a system-wide GUI setup. `--modify-path=no` keeps the install app-managed; Lexy should pass the resolved binary paths when compiling.

## Strawberry Perl: portable ZIP (no admin)

Decided 2026-11-13. The MSI (`/qn`) installs per-machine into `C:\Strawberry`, which needs administrator rights; run silently it cannot show the UAC prompt and fails with exit code **1603** and no output. Lexy now uses the official **portable** ZIP instead:

| Item | Value |
| --- | --- |
| URL | `https://github.com/StrawberryPerl/Perl-Dist-Strawberry/releases/download/SP_54221_64bit/strawberry-perl-5.42.2.1-64bit-portable.zip` |
| Size | 304,301,401 bytes |
| SHA-256 | `32d83be90cf04b807cfb9477482bc36302cdee6f5b04cf57e81adecbd8f07898` (GitHub release asset digest) |
| Installed to | `%LOCALAPPDATA%\Lexy\Setup\StrawberryPerl` (`perl\bin\perl.exe` is checked first by detection) |

No PATH or registry changes: compiles add the Perl folder to latexmk's PATH themselves.

## Progress Reporting

The installer lives in `src-tauri/src/setup.rs` and emits `setup-progress` events:

```ts
{ step, state: "running" | "done" | "skipped" | "error", label, detail, progress /* overall 0-100 */, bytesDone?, bytesTotal? }
```

Steps (ids shared with `SETUP_STEPS` in `src/SetupScreen.tsx`):

| Step id | What happens | Progress |
| --- | --- | --- |
| `check` | Probe MiKTeX, latexmk, Perl | — |
| `perl-download` | Download the portable ZIP (Rust HTTP, `.part` file, streaming SHA-256) | bytes, speed, time left |
| `perl-extract` | Unzip into a staging folder, then swap in; ZIP removed afterwards | bytes |
| `miktex-download` | Download `miktexsetup-x64.zip` | bytes |
| `miktex-extract` | Unzip the setup utility | bytes |
| `miktex-packages` | `miktexsetup_standalone ... download` (or `miktex packages install latexmk` if only latexmk is missing) | live output lines |
| `miktex-install` | `miktexsetup_standalone ... install` (per-user) | live output lines |
| `verify` | Probe all three again | — |

Steps for tools that are already installed are reported as `skipped`. A verified earlier download is reused on retry. Only one setup runs at a time.

## Setup Log

Every step, error and line of MiKTeX output is written to `%LOCALAPPDATA%\Lexy\Setup\setup.log` (rewritten each run). The setup screen's **Show details** reads its last 400 lines (`read_setup_log`) and can copy them.

## Security Notes

- Strawberry Perl is pinned to an exact version and SHA-256; a mismatch deletes the download and stops setup.
- `miktexsetup-x64.zip` is only published at a rolling "latest" URL, so it can't be hash-pinned; it is fetched over HTTPS from miktex.org. Pin a versioned URL if MiKTeX offers one.
- ZIP entries that would escape the target folder are refused.
- Downloads use Windows' own TLS (SChannel via `native-tls`), so system proxies and certificates apply.

## Current Gaps

- No cancel button during setup (closing Lexy stops it; finished downloads are reused next time).
- MiKTeX's package download has no byte total, so its step shows live output and an estimated bar.
- Fresh Windows VM validation is still required.
