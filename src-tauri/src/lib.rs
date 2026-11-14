use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    env,
    ffi::OsStr,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{ipc::Response, AppHandle, Emitter, Manager, State};

mod git;
mod project;
mod bangla;
mod kriti;
mod setup;
mod sync;
mod spell;
mod web;
mod snapshots;
mod settings;
mod export;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolProbe {
    name: &'static str,
    installed: bool,
    version: Option<String>,
    path: Option<String>,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentStatus {
    ready: bool,
    miktex: ToolProbe,
    perl: ToolProbe,
    latexmk: ToolProbe,
}

// Probing and installing spawn processes for seconds to minutes; keep them off the UI thread.
#[tauri::command]
async fn check_environment() -> Result<EnvironmentStatus, String> {
    tauri::async_runtime::spawn_blocking(detect_environment)
        .await
        .map_err(|error| format!("environment check failed: {error}"))
}

/// True while a setup run is in progress; a second click must not start another.
struct SetupGuard(Arc<AtomicBool>);

#[tauri::command]
async fn start_initial_setup(app: AppHandle, guard: State<'_, SetupGuard>) -> Result<EnvironmentStatus, String> {
    if guard.0.swap(true, Ordering::SeqCst) {
        return Err("Setup is already running.".into());
    }
    let running = Arc::clone(&guard.0);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let root = setup_root()?;
        let emit = |event: setup::SetupProgress| {
            let _ = app.emit("setup-progress", event);
        };
        let report = setup::Reporter::new(&emit, Some(&root.join("setup.log")));
        setup::run_setup(&report, &root)
    })
    .await
    .map_err(|error| format!("setup task failed: {error}"));
    running.store(false, Ordering::SeqCst);
    result?
}

/// The end of the last setup run's log, for the setup screen's Details view.
#[tauri::command]
fn read_setup_log() -> Result<String, String> {
    Ok(setup::log_tail(&setup_root()?.join("setup.log"), 400))
}

fn detect_environment() -> EnvironmentStatus {
    let perl = probe_tool("Strawberry Perl", "perl", &["--version"], &perl_candidates(), &[]);
    let miktex = probe_tool("MiKTeX", "miktex", &["--version"], &miktex_candidates("miktex"), &[]);
    // latexmk is a Perl script: MiKTeX's latexmk.exe only works when perl is on its PATH,
    // and Lexy's own portable Perl is never on the user's PATH. Probe it the way compiles run it.
    let perl_dir: Vec<PathBuf> = perl
        .path
        .as_deref()
        .and_then(|path| Path::new(path).parent().map(Path::to_path_buf))
        .into_iter()
        .collect();
    let latexmk = probe_tool("latexmk", "latexmk", &["--version"], &miktex_candidates("latexmk"), &perl_dir);

    EnvironmentStatus {
        ready: perl.installed && miktex.installed && latexmk.installed,
        miktex,
        perl,
        latexmk,
    }
}

fn probe_tool(
    name: &'static str,
    command_name: &str,
    version_args: &[&str],
    candidates: &[PathBuf],
    path_prefix: &[PathBuf],
) -> ToolProbe {
    let executable = candidates
        .iter()
        .find(|path| path.exists())
        .cloned()
        .or_else(|| find_on_path(command_name));

    let Some(path) = executable else {
        return ToolProbe {
            name,
            installed: false,
            version: None,
            path: None,
            message: format!("{name} was not found."),
        };
    };

    let mut command = Command::new(&path);
    if !path_prefix.is_empty() {
        if let Ok(value) = path_with_prefix(path_prefix) {
            command.env("PATH", value);
        }
    }
    match hide_console(&mut command)
        .args(version_args)
        .stdin(Stdio::null())
        .output()
    {
        Ok(output) if output.status.success() => {
            let version = version_line(&output.stdout).or_else(|| version_line(&output.stderr));
            ToolProbe {
                name,
                installed: true,
                version,
                path: Some(path.display().to_string()),
                message: format!("{name} is available."),
            }
        }
        Ok(output) => ToolProbe {
            name,
            installed: false,
            version: None,
            path: Some(path.display().to_string()),
            message: match first_output_line(&output.stderr).or_else(|| first_output_line(&output.stdout)) {
                Some(reason) => format!("{name} is installed but could not run: {reason}"),
                None => format!("{name} is installed but exited with code {:?}.", output.status.code()),
            },
        },
        Err(error) => ToolProbe {
            name,
            installed: false,
            version: None,
            path: Some(path.display().to_string()),
            message: format!("{name} could not be executed: {error}"),
        },
    }
}

fn verify_sha256(path: &Path, expected_sha256: Option<&str>) -> Result<(), String> {
    let Some(expected) = expected_sha256 else {
        return Ok(());
    };

    let mut file = File::open(path).map_err(|error| format!("failed to open {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    let actual = format!("{:x}", hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(format!(
            "checksum mismatch for {}: expected {expected}, got {actual}",
            path.display()
        ));
    }
    Ok(())
}

pub(crate) fn find_on_path(command_name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    for entry in env::split_paths(&path) {
        let candidate = entry.join(command_name);
        if candidate.exists() {
            return Some(candidate);
        }

        #[cfg(windows)]
        {
            let candidate = entry.join(format!("{command_name}.exe"));
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn perl_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    // Lexy's own portable Strawberry Perl (installed without admin rights).
    if let Ok(root) = setup_root() {
        candidates.push(root.join(setup::PERL_DIR).join(r"perl\bin\perl.exe"));
    }
    candidates.push(PathBuf::from(r"C:\Strawberry\perl\bin\perl.exe"));
    if let Some(program_files) = env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join(r"Strawberry\perl\bin\perl.exe"));
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local_app_data).join(r"Programs\Strawberry\perl\bin\perl.exe"));
    }
    candidates
}

fn miktex_candidates(command_name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(root) = setup_root() {
        candidates.push(root.join(r"MiKTeX\miktex\bin\x64").join(format!("{command_name}.exe")));
        candidates.push(root.join(r"MiKTeX\miktex\bin").join(format!("{command_name}.exe")));
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        let local = PathBuf::from(local_app_data);
        candidates.push(local.join(r"Programs\MiKTeX\miktex\bin\x64").join(format!("{command_name}.exe")));
        candidates.push(local.join(r"MiKTeX\miktex\bin\x64").join(format!("{command_name}.exe")));
    }
    candidates
}

fn setup_root() -> Result<PathBuf, String> {
    let base = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "LOCALAPPDATA is not set".to_string())?;
    Ok(base.join("Lexy").join("Setup"))
}

fn find_file_named(root: &Path, name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.file_name().and_then(OsStr::to_str) == Some(name) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file_named(&path, name) {
                return Some(found);
            }
        }
    }
    None
}

fn first_output_line(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

/// The line that names the version (latexmk prints code-page notices first), else the first line.
fn version_line(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .find(|line| line.to_ascii_lowercase().contains("version"))
        .map(ToOwned::to_owned)
        .or_else(|| first_output_line(bytes))
}

fn format_bytes(bytes: u64) -> String {
    const MIB: u64 = 1024 * 1024;
    if bytes >= MIB {
        format!("{:.1} MiB", bytes as f64 / MIB as f64)
    } else {
        format!("{bytes} bytes")
    }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const MAX_DOCUMENT_BYTES: u64 = 10 * 1024 * 1024;

/// Only absolute `.tex` paths reach the filesystem.
fn validate_tex_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(format!("expected an absolute path, got {}", path.display()));
    }
    let is_tex = path
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("tex"));
    if !is_tex {
        return Err(format!("{} is not a .tex file", path.display()));
    }
    Ok(path)
}

/// Write to a sibling temp file, flush it to disk, then rename over the target,
/// so a crash mid-save never leaves a half-written document.
fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("{} has no file name", path.display()))?;
    let temp = path.with_file_name(format!(".{}.lexy-tmp", file_name.to_string_lossy()));
    let write = || -> std::io::Result<()> {
        let mut file = File::create(&temp)?;
        file.write_all(contents)?;
        file.sync_all()
    };
    if let Err(error) = write() {
        let _ = fs::remove_file(&temp);
        return Err(format!("failed to write {}: {error}", path.display()));
    }
    fs::rename(&temp, path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("failed to save {}: {error}", path.display())
    })
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

const COMPILE_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Engine {
    Pdflatex,
    Xelatex,
    Lualatex,
}

impl Engine {
    fn latexmk_flag(self) -> &'static str {
        match self {
            Engine::Pdflatex => "-pdf",
            Engine::Xelatex => "-xelatex",
            Engine::Lualatex => "-lualatex",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompileResult {
    ok: bool,
    summary: String,
    log: String,
    pdf_path: Option<String>,
    engine: Engine,
    problems: Vec<sync::Problem>,
    /// Set when Lexy added a font to the compile copy because Bangla text had none.
    auto_font: Option<String>,
    /// Where `pdf_path` and its SyncTeX data live, for the lookups (spec 003).
    #[serde(skip)]
    shown: Option<sync::Shown>,
    /// MiKTeX's bin folder (where `synctex.exe` lives).
    #[serde(skip)]
    tools_dir: Option<PathBuf>,
}

/// One compile at a time per process: live and explicit compiles share build folders.
struct CompileLock(Arc<Mutex<()>>);

impl Engine {
    fn display_name(self) -> &'static str {
        match self {
            Engine::Pdflatex => "pdfLaTeX",
            Engine::Xelatex => "XeLaTeX",
            Engine::Lualatex => "LuaLaTeX",
        }
    }
}

/// Engine from a `% !TEX program = …` (or `TS-program`) line in the first 5 lines,
/// the TeXworks/TeXShop convention, so the document stays the single source of truth.
fn marker_engine(source: &str) -> Option<Engine> {
    for line in source.lines().take(5) {
        let Some(comment) = line.trim().strip_prefix('%') else { continue };
        let lower = comment.trim_start().to_ascii_lowercase();
        let Some(rest) = lower.strip_prefix("!tex") else { continue };
        let rest = rest.trim_start();
        let Some(rest) = rest.strip_prefix("ts-program").or_else(|| rest.strip_prefix("program")) else {
            continue;
        };
        let Some(value) = rest.trim_start().strip_prefix('=') else { continue };
        return match value.trim() {
            "xelatex" => Some(Engine::Xelatex),
            "lualatex" => Some(Engine::Lualatex),
            "pdflatex" => Some(Engine::Pdflatex),
            _ => None,
        };
    }
    None
}

/// Packages and classes that only run on XeLaTeX or LuaLaTeX (spec 005, research R1).
const UNICODE_ENGINE_PACKAGES: [&str; 10] =
    ["latexbangla", "fontspec", "polyglossia", "unicode-math", "xeCJK", "luatexja", "bidi", "xltxtra", "xunicode", "mathspec"];
const UNICODE_ENGINE_CLASSES: [&str; 4] = ["bookbangla", "ctexart", "ctexbook", "ctexrep"];

/// Text before `\begin{document}`, with `%` comments removed (`\%` is kept).
fn preamble(text: &str) -> String {
    let mut out = String::new();
    for line in text.lines() {
        let mut code = line;
        let mut previous = ' ';
        for (index, ch) in line.char_indices() {
            if ch == '%' && previous != '\\' {
                code = &line[..index];
                break;
            }
            previous = ch;
        }
        if let Some(index) = code.find("\\begin{document}") {
            out.push_str(&code[..index]);
            break;
        }
        out.push_str(code);
        out.push('\n');
    }
    out
}

/// Comma-separated names in every `\<command>[…]{a,b}` of `text`.
fn command_args(text: &str, command: &str) -> Vec<String> {
    let needle = format!("\\{command}");
    let mut names = Vec::new();
    for (index, _) in text.match_indices(&needle) {
        let mut rest = &text[index + needle.len()..];
        if rest.starts_with(|c: char| c.is_ascii_alphabetic()) {
            continue; // \usepackageX is another command
        }
        rest = rest.trim_start();
        if let Some(options) = rest.strip_prefix('[') {
            let Some(end) = options.find(']') else { continue };
            rest = options[end + 1..].trim_start();
        }
        let Some(body) = rest.strip_prefix('{') else { continue };
        let Some(end) = body.find('}') else { continue };
        names.extend(body[..end].split(',').map(|name| name.trim().to_string()).filter(|name| !name.is_empty()));
    }
    names
}

/// Files the preamble pulls in with `\input` / `\include` (`.tex` added when missing).
fn preamble_inputs(preamble: &str) -> Vec<String> {
    ["input", "include"]
        .into_iter()
        .flat_map(|command| command_args(preamble, command))
        .map(|name| if name.to_ascii_lowercase().ends_with(".tex") { name } else { format!("{name}.tex") })
        .collect()
}

/// Engine for a compile and why (data-model.md EngineChoice): the explicit marker, else the
/// first Unicode-engine class or package in the preamble (and the preamble files it inputs),
/// else pdfLaTeX.
fn choose_engine(main_text: &str, included: &[String]) -> (Engine, String) {
    if let Some(engine) = marker_engine(main_text) {
        return (engine, "marker".into());
    }
    let texts: Vec<String> = std::iter::once(preamble(main_text)).chain(included.iter().map(|text| preamble(text))).collect();
    for text in &texts {
        if let Some(class) = command_args(text, "documentclass").into_iter().find(|name| UNICODE_ENGINE_CLASSES.contains(&name.as_str())) {
            return (Engine::Xelatex, class);
        }
        let packages = command_args(text, "usepackage").into_iter().chain(command_args(text, "RequirePackage"));
        if let Some(package) = packages.into_iter().find(|name| UNICODE_ENGINE_PACKAGES.contains(&name.as_str())) {
            return (Engine::Xelatex, package);
        }
    }
    (Engine::Pdflatex, "default".into())
}

/// Printable ASCII only (0x20–0x7E): what latexmk (Perl) passes through intact (research R4).
fn is_plain_ascii(text: &str) -> bool {
    text.chars().all(|c| (' '..='~').contains(&c))
}

/// Snapshot file name for latexmk: the main stem when it is safe, else `document`.
/// The exported PDF keeps the real name (`export_pdf` names it after the main document).
fn snapshot_stem(stem: &str) -> String {
    let safe = !stem.is_empty() && is_plain_ascii(stem) && stem.trim() == stem && !stem.contains(['%', '#', '&', '{', '}', '~', '^', '$']);
    if safe { stem.to_string() } else { "document".to_string() }
}

/// Link name inside a build folder for projects whose path latexmk can't pass on.
const ROOT_LINK: &str = ".lexy-root";

/// The project path TeX should search: the root itself when it is plain ASCII, else an ASCII
/// junction `<out_dir>\.lexy-root` pointing at it. Returns a log note when the link fails.
fn tex_project_path(out_dir: &Path, root: &Path) -> (PathBuf, Option<String>) {
    if is_plain_ascii(&root.display().to_string()) {
        return (root.to_path_buf(), None);
    }
    let link = out_dir.join(ROOT_LINK);
    let target = fs::canonicalize(root).ok();
    if link.exists() && fs::canonicalize(&link).ok() == target {
        return (link, None);
    }
    // Removes only the link (a junction is an empty reparse-point directory), never its target.
    let _ = fs::remove_dir(&link);
    let mut mklink = Command::new("cmd");
    let made = hide_console(&mut mklink)
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(root)
        .stdin(Stdio::null())
        .output()
        .is_ok_and(|output| output.status.success());
    if made {
        (link, None)
    } else {
        (
            root.to_path_buf(),
            Some("Could not create an ASCII link to the project folder; files with non-Latin names may not be found.".into()),
        )
    }
}

/// `The font "X" cannot be found` from fontspec, even when the log wraps it (research R5).
fn missing_font(log: &str) -> Option<String> {
    let joined: Vec<&str> = log.lines().map(|line| line.trim_start_matches("(fontspec)").trim()).collect();
    let joined = joined.join(" ");
    let start = joined.find("The font \"")? + "The font \"".len();
    let end = joined[start..].find('"')?;
    joined[start + end..].starts_with("\" cannot be found").then(|| joined[start..start + end].to_string())
}

/// A missing `.sty`/`.cls` after MiKTeX's installer ran means it could not be installed.
fn missing_package(log: &str) -> Option<String> {
    let line = log.lines().find(|line| line.contains("LaTeX Error: File `"))?;
    let start = line.find("File `")? + "File `".len();
    let end = line[start..].find('\'')?;
    let file = &line[start..start + end];
    let name = file.strip_suffix(".sty").or_else(|| file.strip_suffix(".cls"))?;
    Some(name.to_string())
}

/// An open file's unsaved text, sent with each compile (contracts/backend-commands.md).
#[derive(Clone, Debug, serde::Deserialize)]
struct Buffer {
    path: String,
    text: String,
}

#[tauri::command]
async fn compile_project(
    main: String,
    buffers: Vec<Buffer>,
    lock: State<'_, CompileLock>,
    project: State<'_, project::ProjectState>,
    sync_state: State<'_, sync::SyncState>,
) -> Result<CompileResult, project::ProjectError> {
    let root = project.with(|open| {
        let expected = open.main.as_deref().unwrap_or_default();
        if !expected.replace('/', "\\").eq_ignore_ascii_case(&main.replace('/', "\\")) {
            return Err(project::ProjectError::new(project::ErrorKind::NotFound, format!("{main} is not the main document")));
        }
        Ok(open.root.clone())
    })?;
    let lock = Arc::clone(&lock.0);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        compile_project_at(&build_root()?, &root, &main, &buffers)
    })
    .await
    .map_err(|error| format!("compile task failed: {error}"))?;
    let mut result = result?;
    if let Some(shown) = result.shown.take() {
        sync_state.store(shown);
    }
    Ok(result)
}

/// Review → Export PDF with notes (spec 007 US4): `buffers` already carry the `\todo{}` notes.
/// Compiled in its own build root, so the preview and its SyncTeX data are never touched;
/// the PDF is saved as `<stem> (notes).pdf` beside the main document. Returns that file name.
fn export_pdf_with_notes_at(build_root: &Path, root: &Path, main: &str, buffers: &[Buffer]) -> Result<String, project::ProjectError> {
    use project::{ErrorKind, ProjectError};
    let result = compile_project_at(&build_root.join("Notes"), root, main, buffers)?;
    let pdf = match (&result.pdf_path, result.ok) {
        (Some(pdf), true) => PathBuf::from(pdf),
        _ => return Err(ProjectError::new(ErrorKind::Io, format!("The PDF with notes didn't compile. {}", result.summary))),
    };
    let main_path = project::resolve_in_project(root, main)?;
    let stem = main_path.file_stem().and_then(OsStr::to_str).unwrap_or("document");
    let name = format!("{stem} (notes).pdf");
    let bytes = fs::read(&pdf).map_err(|error| ProjectError::new(ErrorKind::Io, format!("failed to read the PDF: {error}")))?;
    write_atomic(&main_path.with_file_name(&name), &bytes).map_err(|error| ProjectError::new(ErrorKind::Io, format!("{error} (is the PDF open in another program?)")))?;
    Ok(name)
}

#[tauri::command]
async fn export_pdf_with_notes(
    main: String,
    buffers: Vec<Buffer>,
    lock: State<'_, CompileLock>,
    project: State<'_, project::ProjectState>,
) -> Result<String, project::ProjectError> {
    let root = project.with(|open| {
        if open.read_only {
            return Err(project::ProjectError::new(project::ErrorKind::ReadOnly, "this project is open in another Lexy window"));
        }
        Ok(open.root.clone())
    })?;
    let lock = Arc::clone(&lock.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        export_pdf_with_notes_at(&build_root()?, &root, &main, &buffers)
    })
    .await
    .map_err(|error| format!("export task failed: {error}"))?
}

/// The build folder of a project's main document (same key for compiles and lookups).
pub(crate) fn build_dir_for(root: &Path, main: &str) -> Result<PathBuf, String> {
    let main_path = project::resolve_in_project(root, main).map_err(|error| error.message)?;
    Ok(build_root()?.join(build_key(Path::new(&project::display_path(&main_path)))))
}

/// Overlay folder inside a build folder; its leading dot keeps it out of the mirrored tree.
const OVERLAY: &str = ".lexy-overlay";

/// Compile a project's main document without touching the user's files (research R1):
/// the main text is written as a snapshot into the build folder, unsaved open files go into
/// an overlay folder that TeX searches before the project, and saved files and images are
/// read straight from the project folder.
fn compile_project_at(build_root: &Path, root: &Path, main: &str, buffers: &[Buffer]) -> Result<CompileResult, project::ProjectError> {
    use project::{resolve_in_project, ErrorKind, ProjectError};
    let main_path = resolve_in_project(root, main)?;
    let is_tex = main_path.extension().and_then(OsStr::to_str).is_some_and(|ext| ext.eq_ignore_ascii_case("tex"));
    if !is_tex {
        return Err(ProjectError::new(ErrorKind::InvalidName, format!("{main} is not a .tex file")));
    }
    let mut overlay_files = Vec::new();
    for buffer in buffers {
        let path = resolve_in_project(root, &buffer.path)?;
        let name = path.file_name().and_then(OsStr::to_str).unwrap_or_default();
        if !project::classify(name, false).0 {
            return Err(ProjectError::new(ErrorKind::InvalidName, format!("{} can't be compiled", buffer.path)));
        }
        if buffer.text.len() as u64 > MAX_DOCUMENT_BYTES {
            return Err(ProjectError::new(ErrorKind::Io, format!("{} is larger than 10 MiB", buffer.path)));
        }
        overlay_files.push((path, buffer.text.as_str()));
    }
    let main_text = match overlay_files.iter().find(|(path, _)| *path == main_path) {
        Some((_, text)) => text.to_string(),
        None if main_path.is_file() => project::read_file_at(root, main)?,
        None => return Err(ProjectError::new(ErrorKind::NotFound, format!("{main} does not exist"))),
    };

    // Preamble files pulled in with \input/\include also decide the engine (buffers win over disk).
    let included: Vec<String> = preamble_inputs(&preamble(&main_text))
        .iter()
        .filter_map(|rel| {
            let path = resolve_in_project(root, rel).ok()?;
            match overlay_files.iter().find(|(buffered, _)| *buffered == path) {
                Some((_, text)) => Some(text.to_string()),
                None => project::read_file_at(root, rel).ok(),
            }
        })
        .collect();
    let (mut engine, mut reason) = choose_engine(&main_text, &included);

    // Bangla text with no font setup would fail on pdfLaTeX: compile a copy with XeLaTeX and a
    // Windows font instead (the user's file is untouched; the UI offers a portable fix).
    let mut main_text = main_text;
    let mut auto_font = None;
    if reason == "default" {
        let body_files: Vec<String> = ["input", "include"]
            .into_iter()
            .flat_map(|command| command_args(&bangla::without_comments(&main_text), command))
            .filter_map(|name| {
                let rel = if name.to_ascii_lowercase().ends_with(".tex") { name } else { format!("{name}.tex") };
                let path = resolve_in_project(root, &rel).ok()?;
                match overlay_files.iter().find(|(buffered, _)| *buffered == path) {
                    Some((_, text)) => Some(text.to_string()),
                    None => project::read_file_at(root, &rel).ok(),
                }
            })
            .collect();
        let bangla = std::iter::once(&main_text).chain(&body_files).any(|text| bangla::has_bangla(&bangla::without_comments(text)));
        if let Some(patched) = bangla.then(|| bangla::with_system_font(&main_text)).flatten() {
            main_text = patched;
            engine = Engine::Xelatex;
            reason = format!("Bangla text without a font setup; using {} for this compile", bangla::SYSTEM_FONT);
            auto_font = Some(bangla::SYSTEM_FONT.to_string());
        }
    }

    // Plain (non-`\\?\`) paths: TeX and latexmk don't understand verbatim paths.
    let plain_root = PathBuf::from(project::display_path(root));
    let main_abs = PathBuf::from(project::display_path(&main_path));
    let real_stem = main_abs.file_stem().and_then(OsStr::to_str).ok_or_else(|| "document name is not valid text".to_string())?;
    let stem = snapshot_stem(real_stem);
    let out_dir = build_root.join(build_key(&main_abs));
    fs::create_dir_all(&out_dir).map_err(|error| format!("failed to create build folder: {error}"))?;
    write_atomic(&out_dir.join(format!("{stem}.tex")), main_text.as_bytes())?;

    let overlay = out_dir.join(OVERLAY);
    // latexmk only compares the inputs it recorded last time, so when a file moves between the
    // project and the overlay it would skip the rerun; forget its database then.
    let mut listed: Vec<String> = overlay_files.iter().map(|(path, _)| path.display().to_string().to_lowercase()).collect();
    listed.sort();
    let list_file = out_dir.join(".lexy-overlay.list");
    if fs::read_to_string(&list_file).unwrap_or_default() != listed.join("|") {
        let _ = fs::remove_file(out_dir.join(format!("{stem}.fdb_latexmk")));
        let _ = fs::write(&list_file, listed.join("|"));
    }
    let _ = fs::remove_dir_all(&overlay);
    for (path, text) in &overlay_files {
        let Ok(rel) = path.strip_prefix(root) else { continue };
        let target = overlay.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("failed to create overlay folder: {error}"))?;
        }
        write_atomic(&target, text.as_bytes())?;
    }
    // \include{chapters/x} writes chapters\x.aux next to the main .aux, so the folders must exist.
    mirror_folders(root, &out_dir);

    let (tex_root, note) = tex_project_path(&out_dir, &plain_root);
    let search_path = env::join_paths([overlay, tex_root.clone(), PathBuf::new()])
        .map_err(|error| format!("failed to build TEXINPUTS: {error}"))?;
    let mut result = run_latexmk(&out_dir, &stem, engine, &reason, &search_path)?;
    if let Some(note) = note {
        result.log = format!("{note}\n{}", result.log);
    }

    result.auto_font = auto_font;

    // Problems with project-relative files, and the shown slot for click-to-jump (spec 003).
    let mut roots = vec![plain_root.clone()];
    if tex_root != plain_root {
        roots.push(tex_root.clone());
    }
    let table = sync::PathTable {
        base: out_dir.clone(),
        main_snapshot: out_dir.join(format!("{stem}.tex")),
        main_rel: main.replace('\\', "/"),
        overlay: out_dir.join(OVERLAY),
        roots,
    };
    let tex_log = fs::read(out_dir.join(format!("{stem}.log"))).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    result.problems = sync::parse_problems(&tex_log, &table);
    if !result.ok && !result.problems.iter().any(|p| p.severity == sync::Severity::Error) {
        result.problems.insert(0, sync::Problem { severity: sync::Severity::Error, file: None, line: None, message: result.summary.clone() });
    }
    if result.ok {
        let pdf = sync::publish(&out_dir, &stem)?;
        result.pdf_path = Some(pdf.display().to_string());
        let synctex_exe = sync::synctex_beside(result.tools_dir.as_deref());
        result.shown = Some(sync::Shown { out_dir: out_dir.clone(), pdf, table, synctex_exe });
    }
    Ok(result)
}

/// Recreate the project's (non-hidden) folder tree inside `target`.
fn mirror_folders(source: &Path, target: &Path) {
    let Ok(entries) = fs::read_dir(source) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let is_dir = entry.file_type().is_ok_and(|kind| kind.is_dir());
        if !is_dir || name.to_string_lossy().starts_with('.') {
            continue;
        }
        let inner = target.join(&name);
        if fs::create_dir_all(&inner).is_ok() {
            mirror_folders(&entry.path(), &inner);
        }
    }
}

/// Run latexmk on `<out_dir>\<stem>.tex`; `search_path` (ASCII only) is used for TeX inputs,
/// bibliographies and font files. The log starts with the engine and why it was chosen.
fn run_latexmk(out_dir: &Path, stem: &str, engine: Engine, reason: &str, search_path: &std::ffi::OsStr) -> Result<CompileResult, String> {
    let mut result = run_latexmk_inner(out_dir, stem, engine, search_path)?;
    result.log = format!("Engine: {} ({reason})\n\n{}", engine.display_name(), result.log);
    Ok(result)
}

fn run_latexmk_inner(out_dir: &Path, stem: &str, engine: Engine, inputs: &std::ffi::OsStr) -> Result<CompileResult, String> {
    // Always revalidate tool paths before compiling (docs/PLAN.md).
    let environment = detect_environment();
    if !environment.ready {
        let missing: Vec<&str> = [&environment.miktex, &environment.latexmk, &environment.perl]
            .into_iter()
            .filter(|tool| !tool.installed)
            .map(|tool| tool.name)
            .collect();
        return Ok(CompileResult {
            ok: false,
            summary: format!("{} missing", missing.join(", ")),
            log: "Lexy could not find the LaTeX tools it needs. Restart Lexy to run setup.".into(),
            pdf_path: None,
            engine,
            problems: Vec::new(),
            auto_font: None,
            shown: None,
            tools_dir: None,
        });
    }

    let latexmk = environment
        .latexmk
        .path
        .as_deref()
        .map(PathBuf::from)
        .ok_or("latexmk path is unknown")?;
    // latexmk shells out to the TeX engine (MiKTeX) and needs perl, so put all three on its PATH.
    let tool_dirs: Vec<PathBuf> = [&environment.latexmk.path, &environment.miktex.path, &environment.perl.path]
        .into_iter()
        .flatten()
        .filter_map(|path| Path::new(path).parent().map(Path::to_path_buf))
        .collect();

    let mut command = Command::new(&latexmk);
    command
        .args([engine.latexmk_flag(), "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-synctex=1"])
        // MiKTeX installs missing packages for this run only, without a dialog (research R6).
        .args([
            "-pdflatex=pdflatex -enable-installer -max-print-line=1000 %O %S",
            "-xelatex=xelatex -enable-installer -max-print-line=1000 %O %S",
            "-lualatex=lualatex -enable-installer -max-print-line=1000 %O %S",
        ])
        .arg(format!("{stem}.tex"))
        .current_dir(out_dir)
        .env("PATH", path_with_prefix(&tool_dirs)?)
        .env("TEXINPUTS", inputs)
        .env("BIBINPUTS", inputs)
        // Font files in the project, by name or project-relative Path= (research R3).
        .env("TTFONTS", inputs)
        .env("OPENTYPEFONTS", inputs);
    let output = run_with_timeout(command, COMPILE_TIMEOUT)?;

    let pdf = out_dir.join(format!("{stem}.pdf"));
    let tex_log = fs::read(out_dir.join(format!("{stem}.log")))
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default();
    let ok = output.success && pdf.is_file();
    let summary = if ok {
        "PDF ready".to_string()
    } else if output.timed_out {
        format!("Compile stopped after {} s", COMPILE_TIMEOUT.as_secs())
    } else if let Some(font) = missing_font(&tex_log) {
        format!("Font \"{font}\" not found")
    } else if let Some(package) = missing_package(&tex_log) {
        format!("Package \"{package}\" could not be found or installed (offline?)")
    } else {
        first_latex_error(&tex_log)
            .or_else(|| first_latex_error(&output.stdout))
            .or_else(|| first_latex_error(&output.stderr))
            .unwrap_or_else(|| format!("Compile failed (exit code {:?})", output.code))
    };

    Ok(CompileResult {
        ok,
        summary,
        log: compose_log(&output, &tex_log),
        pdf_path: ok.then(|| pdf.display().to_string()),
        engine,
        problems: Vec::new(),
        auto_font: None,
        shown: None,
        tools_dir: environment.miktex.path.as_deref().and_then(|path| Path::new(path).parent()).map(Path::to_path_buf),
    })
}


fn compose_log(output: &ProcessOutput, tex_log: &str) -> String {
    let mut log = String::new();
    for (title, text) in [("latexmk", output.stdout.as_str()), ("errors", output.stderr.as_str()), ("LaTeX log", tex_log)] {
        if !text.trim().is_empty() {
            if !log.is_empty() {
                log.push_str("\n\n");
            }
            log.push_str(&format!("--- {title} ---\n{}", text.trim_end()));
        }
    }
    if log.is_empty() {
        log.push_str("No output.");
    }
    log
}

/// First error in a LaTeX log: a `file:line: message` line (from -file-line-error)
/// becomes "Line N: message"; a classic `! message` line is returned as-is.
fn first_latex_error(log: &str) -> Option<String> {
    log.lines().find_map(|line| {
        if let Some(message) = line.strip_prefix("! ") {
            return Some(message.trim().to_string());
        }
        line.match_indices(':').find_map(|(index, _)| {
            let rest = &line[index + 1..];
            let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
            let message = rest[digits..].strip_prefix(": ")?;
            (digits > 0 && !message.trim().is_empty())
                .then(|| format!("Line {}: {}", &rest[..digits], message.trim()))
        })
    })
}

fn build_root() -> Result<PathBuf, String> {
    build_root_from(
        env::var_os("LOCALAPPDATA").map(PathBuf::from),
        env::var_os("ProgramData").map(PathBuf::from),
        env::var_os("USERPROFILE").map(PathBuf::from),
    )
}

/// `%LOCALAPPDATA%\Lexy\Build`, or an ASCII folder under ProgramData when the user's profile
/// path has non-Latin characters that latexmk can't pass on (research R4).
fn build_root_from(local: Option<PathBuf>, program_data: Option<PathBuf>, profile: Option<PathBuf>) -> Result<PathBuf, String> {
    let local = local.ok_or_else(|| "LOCALAPPDATA is not set".to_string())?.join("Lexy").join("Build");
    if is_plain_ascii(&local.display().to_string()) {
        return Ok(local);
    }
    // shortcut: ProgramData is shared by all local users; the hash keeps folders apart. Upgrade to a per-user ASCII location if this matters.
    match program_data.filter(|dir| is_plain_ascii(&dir.display().to_string())) {
        Some(shared) => Ok(shared.join("Lexy").join("Build").join(build_key(&profile.unwrap_or_default()))),
        None => Ok(local),
    }
}

/// One build folder per document, keyed by its (case-insensitive) path, so
/// aux files never land next to the user's document.
fn build_key(source: &Path) -> String {
    let key = source.display().to_string().to_lowercase();
    format!("{:x}", Sha256::digest(key.as_bytes()))[..16].to_string()
}

fn path_with_prefix(dirs: &[PathBuf]) -> Result<std::ffi::OsString, String> {
    let existing = env::var_os("PATH").unwrap_or_default();
    env::join_paths(dirs.iter().cloned().chain(env::split_paths(&existing)))
        .map_err(|error| format!("failed to build PATH: {error}"))
}

/// Serve PDFs only from Lexy's own build folder.
fn validate_pdf_path(path: &str, root: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|error| format!("failed to open {path}: {error}"))?;
    let root = fs::canonicalize(root).map_err(|error| format!("build folder is missing: {error}"))?;
    let is_pdf = canonical
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));
    if !is_pdf || !canonical.starts_with(&root) {
        return Err(format!("{path} is not a Lexy build output"));
    }
    Ok(canonical)
}

#[tauri::command]
fn read_pdf(path: String) -> Result<Response, String> {
    let path = validate_pdf_path(&path, &build_root()?)?;
    let bytes = fs::read(&path).map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    Ok(Response::new(bytes))
}

/// Copy a compiled PDF from the build folder to `<document folder>\<stem>.pdf`.
#[tauri::command]
fn export_pdf(pdf_path: String, document_path: String) -> Result<String, String> {
    export_pdf_to(&build_root()?, &pdf_path, &document_path)
}

fn export_pdf_to(build_root: &Path, pdf_path: &str, document_path: &str) -> Result<String, String> {
    let pdf = validate_pdf_path(pdf_path, build_root)?;
    let target = validate_tex_path(document_path)?.with_extension("pdf");
    let bytes = fs::read(&pdf).map_err(|error| format!("failed to read {}: {error}", pdf.display()))?;
    write_atomic(&target, &bytes).map_err(|error| format!("{error} (is the PDF open in another program?)"))?;
    Ok(target.display().to_string())
}

// ---------------------------------------------------------------------------
// Default folder and fonts
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct DefaultFolder {
    path: String,
    fallback: bool,
}

/// `<Documents>\Lexy`, created on demand; the home folder when Documents is unusable.
fn lexy_folder<E: std::fmt::Display>(documents: Result<PathBuf, E>, home: Option<PathBuf>) -> Result<DefaultFolder, String> {
    if let Ok(documents) = documents {
        let folder = documents.join("Lexy");
        if fs::create_dir_all(&folder).is_ok() {
            return Ok(DefaultFolder { path: folder.display().to_string(), fallback: false });
        }
    }
    let home = home.ok_or("could not find your Documents or home folder")?;
    Ok(DefaultFolder { path: home.display().to_string(), fallback: true })
}

#[tauri::command]
async fn default_document_folder(app: AppHandle) -> Result<DefaultFolder, String> {
    // document_dir() is FOLDERID_Documents on Windows, so OneDrive redirection is honoured.
    let documents = app.path().document_dir();
    let home = app.path().home_dir().ok();
    tauri::async_runtime::spawn_blocking(move || lexy_folder(documents, home))
        .await
        .map_err(|error| format!("folder lookup failed: {error}"))?
}

/// Font names end up inside `\setmainfont{…}`; only allow characters that can't break out.
fn is_valid_family(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || " _.'&+-".contains(c))
}

fn filter_families<I: IntoIterator<Item = String>>(names: I) -> Vec<String> {
    let mut families: Vec<String> = names
        .into_iter()
        .map(|name| name.trim().to_string())
        .filter(|name| is_valid_family(name))
        .collect();
    families.sort_by_key(|name| name.to_lowercase());
    families.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    families
}

/// Installed font families, read once per process.
struct FontCache(Arc<OnceLock<Vec<String>>>);

#[tauri::command]
async fn list_system_fonts(cache: State<'_, FontCache>) -> Result<Vec<String>, String> {
    let cache = Arc::clone(&cache.0);
    tauri::async_runtime::spawn_blocking(move || {
        cache
            .get_or_init(|| {
                let mut database = fontdb::Database::new();
                database.load_system_fonts();
                filter_families(database.faces().flat_map(|face| face.families.iter().map(|(name, _)| name.clone())))
            })
            .clone()
    })
    .await
    .map_err(|error| format!("font lookup failed: {error}"))
}

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

/// No console window flashes up when Lexy runs a tool (docs/PLAN.md principle 3).
pub(crate) fn hide_console(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub(crate) struct ProcessOutput {
    pub(crate) success: bool,
    pub(crate) code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) timed_out: bool,
}

pub(crate) fn run_with_timeout(mut command: Command, timeout: Duration) -> Result<ProcessOutput, String> {
    let mut child = hide_console(&mut command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start {:?}: {error}", command.get_program()))?;
    // Drain both pipes concurrently so a chatty process can't deadlock on a full buffer.
    let stdout = child.stdout.take().map(read_to_end_in_background);
    let stderr = child.stderr.take().map(read_to_end_in_background);

    let deadline = Instant::now() + timeout;
    let (status, timed_out) = loop {
        if let Some(status) = child.try_wait().map_err(|error| format!("failed to wait for process: {error}"))? {
            break (Some(status), false);
        }
        if Instant::now() >= deadline {
            kill_tree(&mut child);
            break (child.wait().ok(), true);
        }
        thread::sleep(Duration::from_millis(50));
    };

    let collect = |handle: Option<JoinHandle<Vec<u8>>>| {
        handle
            .and_then(|handle| handle.join().ok())
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_default()
    };
    Ok(ProcessOutput {
        success: !timed_out && status.is_some_and(|status| status.success()),
        code: status.and_then(|status| status.code()),
        stdout: collect(stdout),
        stderr: collect(stderr),
        timed_out,
    })
}

fn read_to_end_in_background<R: Read + Send + 'static>(mut reader: R) -> JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = reader.read_to_end(&mut buffer);
        buffer
    })
}

/// latexmk spawns pdflatex; killing only latexmk would leave the child holding our pipes.
pub(crate) fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let mut taskkill = Command::new("taskkill");
        let _ = hide_console(&mut taskkill)
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(CompileLock(Arc::new(Mutex::new(()))))
        .manage(FontCache(Arc::new(OnceLock::new())))
        .manage(SetupGuard(Arc::new(AtomicBool::new(false))))
        .manage(project::ProjectState::default())
        .manage(sync::SyncState::default())
        .manage(git::GitLock::default())
        .manage(spell::SpellState::default())
        .manage(export::ConverterLock::default())
        .invoke_handler(tauri::generate_handler![
            check_environment,
            start_initial_setup,
            read_setup_log,
            compile_project,
            export_pdf_with_notes,
            read_pdf,
            default_document_folder,
            list_system_fonts,
            export_pdf,
            project::list_projects,
            project::last_open_project,
            project::create_project,
            project::count_entries,
            project::forget_project,
            project::open_project,
            project::close_project,
            project::set_main_document,
            project::list_dir,
            project::read_file,
            project::write_file,
            project::project_texts,
            project::copy_entry,
            project::list_snapshots,
            project::read_snapshot,
            settings::get_settings,
            settings::set_settings,
            spell::spell_check,
            spell::spell_suggest,
            spell::dictionary_add,
            web::grammar_check,
            web::fetch_doi,
            export::converter_status,
            export::install_converter,
            export::export_document,
            project::create_file,
            project::create_folder,
            project::rename_entry,
            project::delete_entry,
            project::import_files,
            project::open_entry_external,
            git::git_status,
            git::git_init,
            git::git_set_identity,
            git::git_commit,
            git::git_ignore,
            git::git_diff,
            git::git_log,
            git::git_log_files,
            git::git_show_file,
            git::git_restore,
            git::git_connect_remote,
            git::git_publish_github,
            git::git_push,
            git::git_pull,
            git::git_resolve,
            git::git_abort_merge,
            sync::sync_to_source,
            sync::sync_to_pdf,
            bangla::install_bangla_font,
            kriti::kriti_fonts,
            kriti::install_kriti_font
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fresh, empty directory under the OS temp dir, removed on drop.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = env::temp_dir().join(format!("lexy-test-{}-{label}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("create temp dir");
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    // Any 64-hex value that is not the hash of "lexy".
    const WRONG_SHA256: &str = "3c1a2ac8c4b2bf9c0dcd1f28a3e4e0e4bd5ad7e2d4b3a0c9c1c0b9a3b2f6e1d0";

    fn sha256_hex(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    #[test]
    fn first_output_line_skips_blank_lines_and_trims() {
        assert_eq!(
            first_output_line(b"\n  \r\n  MiKTeX 24.1  \nsecond"),
            Some("MiKTeX 24.1".to_string())
        );
    }

    #[test]
    fn version_line_skips_latexmk_code_page_notices() {
        let latexmk = b"Initial Win CP for (console input, console output, system): (CP65001, CP65001, CP1252)\nI changed them all to CP1252\nLatexmk, John Collins, 9 March 2026. Version 4.88\n";
        assert_eq!(version_line(latexmk).as_deref(), Some("Latexmk, John Collins, 9 March 2026. Version 4.88"));
        assert_eq!(version_line(b"\nThis is perl 5, version 42, subversion 2").as_deref(), Some("This is perl 5, version 42, subversion 2"));
        assert_eq!(version_line(b"One MiKTeX Utility 1.12 (MiKTeX 26.5)\nmore").as_deref(), Some("One MiKTeX Utility 1.12 (MiKTeX 26.5)"));
    }

    #[test]
    fn first_output_line_is_none_for_blank_output() {
        assert_eq!(first_output_line(b""), None);
        assert_eq!(first_output_line(b" \n\t\n"), None);
    }

    #[test]
    fn first_output_line_tolerates_invalid_utf8() {
        let line = first_output_line(&[0xff, b'o', b'k']).expect("a line");
        assert!(line.ends_with("ok"));
    }

    #[test]
    fn format_bytes_below_one_mib_uses_bytes() {
        assert_eq!(format_bytes(0), "0 bytes");
        assert_eq!(format_bytes(1024 * 1024 - 1), "1048575 bytes");
    }

    #[test]
    fn format_bytes_at_and_above_one_mib_uses_mib() {
        assert_eq!(format_bytes(1024 * 1024), "1.0 MiB");
        assert_eq!(format_bytes(1536 * 1024), "1.5 MiB");
        assert_eq!(format_bytes(250 * 1024 * 1024), "250.0 MiB");
    }

    #[test]
    fn verify_sha256_skips_when_no_hash_configured() {
        assert!(verify_sha256(Path::new("does-not-exist"), None).is_ok());
    }

    #[test]
    fn verify_sha256_accepts_matching_hash_case_insensitively() {
        let dir = TempDir::new("sha-ok");
        let file = dir.0.join("a.bin");
        fs::write(&file, b"lexy").unwrap();
        let expected = sha256_hex(b"lexy");
        assert!(verify_sha256(&file, Some(&expected)).is_ok());
        assert!(verify_sha256(&file, Some(&expected.to_uppercase())).is_ok());
    }

    #[test]
    fn verify_sha256_rejects_mismatch_with_both_hashes_in_message() {
        let dir = TempDir::new("sha-bad");
        let file = dir.0.join("a.bin");
        fs::write(&file, b"lexy").unwrap();
        let error = verify_sha256(&file, Some(WRONG_SHA256)).unwrap_err();
        assert!(error.contains("checksum mismatch"));
        assert!(error.contains(WRONG_SHA256));
        assert!(error.contains(&sha256_hex(b"lexy")));
    }

    #[test]
    fn verify_sha256_hashes_files_larger_than_one_buffer() {
        let dir = TempDir::new("sha-big");
        let file = dir.0.join("big.bin");
        let data: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(&file, &data).unwrap();
        assert!(verify_sha256(&file, Some(&sha256_hex(&data))).is_ok());
    }

    #[test]
    fn verify_sha256_reports_missing_file() {
        let error = verify_sha256(Path::new("definitely-missing.bin"), Some("00")).unwrap_err();
        assert!(error.contains("failed to open"));
    }

    #[test]
    fn find_file_named_finds_nested_file() {
        let dir = TempDir::new("find-nested");
        let nested = dir.0.join("a").join("b");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("miktexsetup_standalone.exe"), b"").unwrap();
        assert_eq!(
            find_file_named(&dir.0, "miktexsetup_standalone.exe"),
            Some(nested.join("miktexsetup_standalone.exe"))
        );
    }

    #[test]
    fn find_file_named_returns_none_when_absent_or_root_missing() {
        let dir = TempDir::new("find-none");
        fs::write(dir.0.join("other.exe"), b"").unwrap();
        assert_eq!(find_file_named(&dir.0, "miktexsetup_standalone.exe"), None);
        assert_eq!(find_file_named(&dir.0.join("missing"), "x"), None);
    }

    #[test]
    fn setup_root_is_under_localappdata() {
        if env::var_os("LOCALAPPDATA").is_none() {
            assert!(setup_root().is_err());
            return;
        }
        let root = setup_root().unwrap();
        assert!(root.ends_with(Path::new("Lexy").join("Setup")));
    }

    #[test]
    fn miktex_candidates_prefer_app_managed_install() {
        let candidates = miktex_candidates("latexmk");
        if let Ok(root) = setup_root() {
            assert_eq!(candidates[0], root.join(r"MiKTeX\miktex\bin\x64\latexmk.exe"));
        }
        assert!(candidates.iter().all(|path| path.ends_with("latexmk.exe")));
    }

    #[test]
    fn perl_candidates_prefer_lexys_portable_perl() {
        let candidates = perl_candidates();
        if let Ok(root) = setup_root() {
            assert_eq!(candidates[0], root.join(setup::PERL_DIR).join(r"perl\bin\perl.exe"));
        }
        assert!(candidates.contains(&PathBuf::from(r"C:\Strawberry\perl\bin\perl.exe")));
    }

    #[test]
    fn probe_tool_reports_missing_tool() {
        let probe = probe_tool(
            "Ghost",
            "lexy-no-such-command-9f3b",
            &["--version"],
            &[PathBuf::from(r"Z:\nowhere\ghost.exe")],
            &[],
        );
        assert!(!probe.installed);
        assert_eq!(probe.path, None);
        assert_eq!(probe.message, "Ghost was not found.");
    }

    #[cfg(windows)]
    fn cmd_exe() -> PathBuf {
        find_on_path("cmd").expect("cmd.exe on PATH")
    }

    #[cfg(windows)]
    #[test]
    fn find_on_path_appends_exe_on_windows() {
        assert!(cmd_exe().to_string_lossy().to_lowercase().ends_with("cmd.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn probe_tool_reads_version_from_first_output_line() {
        let probe = probe_tool("Echo", "unused", &["/C", "echo Echo 1.2.3"], &[cmd_exe()], &[]);
        assert!(probe.installed);
        assert_eq!(probe.version.as_deref(), Some("Echo 1.2.3"));
        assert!(probe.path.is_some());
    }

    #[cfg(windows)]
    #[test]
    fn probe_tool_flags_nonzero_exit_as_not_installed() {
        let probe = probe_tool("Broken", "unused", &["/C", "exit 3"], &[cmd_exe()], &[]);
        assert!(!probe.installed);
        assert!(probe.message.contains("exited with code Some(3)"), "{}", probe.message);
        assert!(probe.path.is_some(), "the file exists, so setup must not try to reinstall it");
    }

    #[cfg(windows)]
    #[test]
    fn probe_tool_explains_why_an_installed_tool_could_not_run() {
        let probe = probe_tool("latexmk", "unused", &["/C", "echo perl was not found 1>&2 & exit 1"], &[cmd_exe()], &[]);
        assert!(!probe.installed);
        assert_eq!(probe.message, "latexmk is installed but could not run: perl was not found");
    }

    #[cfg(windows)]
    #[test]
    fn probe_tool_puts_the_given_folders_first_on_path() {
        // This is how latexmk.exe finds Lexy's portable Perl, which is never on the user's PATH.
        let folder = PathBuf::from(r"C:\lexy-test-perl\bin");
        let probe = probe_tool("Echo", "unused", &["/C", "echo %PATH%"], &[cmd_exe()], std::slice::from_ref(&folder));
        assert!(probe.version.unwrap().starts_with(r"C:\lexy-test-perl\bin;"));
    }

    #[test]
    fn environment_status_serializes_in_the_shape_the_frontend_expects() {
        let tool = |name| ToolProbe {
            name,
            installed: true,
            version: Some("1".into()),
            path: None,
            message: "ok".into(),
        };
        let status = EnvironmentStatus {
            ready: true,
            miktex: tool("MiKTeX"),
            perl: tool("Strawberry Perl"),
            latexmk: tool("latexmk"),
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["ready"], true);
        for key in ["miktex", "perl", "latexmk"] {
            let probe = &json[key];
            for field in ["name", "installed", "version", "path", "message"] {
                assert!(probe.get(field).is_some(), "{key}.{field} missing");
            }
        }
        assert!(json["miktex"]["path"].is_null());
    }

    // ----- documents -----

    fn abs(dir: &TempDir, name: &str) -> String {
        dir.0.join(name).display().to_string()
    }

    #[test]
    fn validate_tex_path_accepts_absolute_tex_any_case() {
        let dir = TempDir::new("validate");
        assert!(validate_tex_path(&abs(&dir, "a.tex")).is_ok());
        assert!(validate_tex_path(&abs(&dir, "A.TEX")).is_ok());
    }

    #[test]
    fn validate_tex_path_rejects_relative_and_other_extensions() {
        let dir = TempDir::new("validate-bad");
        assert!(validate_tex_path("main.tex").unwrap_err().contains("absolute"));
        assert!(validate_tex_path(&abs(&dir, "notes.txt")).unwrap_err().contains("not a .tex file"));
        assert!(validate_tex_path(&abs(&dir, "noext")).is_err());
        assert!(validate_tex_path(&abs(&dir, "main.tex.exe")).is_err());
    }

    #[test]
    fn write_atomic_round_trips_exact_text() {
        let dir = TempDir::new("roundtrip");
        let path = dir.0.join("main.tex");
        let text = "\\section{Ünïcødé}\r\nline two\n\n% trailing\n";
        write_atomic(&path, text.as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), text);
    }

    #[test]
    fn write_atomic_replaces_existing_file_and_leaves_no_temp_file() {
        let dir = TempDir::new("replace");
        let path = dir.0.join("main.tex");
        fs::write(&path, "old content that is longer").unwrap();
        write_atomic(&path, b"new").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        let leftovers: Vec<_> = fs::read_dir(&dir.0).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(leftovers, vec![std::ffi::OsString::from("main.tex")]);
    }

    #[test]
    fn write_atomic_fails_cleanly_when_folder_is_missing() {
        let dir = TempDir::new("nofolder");
        let error = write_atomic(&dir.0.join("missing").join("main.tex"), b"x").unwrap_err();
        assert!(error.contains("failed to write"), "{error}");
        assert!(!dir.0.join("missing").exists());
    }

    #[test]
    fn project_read_refuses_files_over_ten_mib() {
        let dir = TempDir::new("read-big");
        File::create(dir.0.join("big.tex")).unwrap().set_len(MAX_DOCUMENT_BYTES + 1).unwrap();
        let root = fs::canonicalize(&dir.0).unwrap();
        assert!(project::read_file_at(&root, "big.tex").unwrap_err().message.contains("larger than 10 MiB"));
    }

    // ----- compile helpers -----

    #[test]
    fn first_latex_error_reads_file_line_error_format() {
        let log = "This is pdfTeX\n(./main.tex\n./main.tex:3: Undefined control sequence.\nl.3 \\foo\n";
        assert_eq!(first_latex_error(log).as_deref(), Some("Line 3: Undefined control sequence."));
    }

    #[test]
    fn first_latex_error_handles_windows_drive_paths() {
        let log = "C:/Users/me/doc/main.tex:12: LaTeX Error: File `foo.sty' not found.";
        assert_eq!(
            first_latex_error(log).as_deref(),
            Some("Line 12: LaTeX Error: File `foo.sty' not found.")
        );
    }

    #[test]
    fn first_latex_error_reads_bang_lines() {
        assert_eq!(first_latex_error("ok\n! Emergency stop.\n").as_deref(), Some("Emergency stop."));
    }

    #[test]
    fn first_latex_error_returns_first_of_several() {
        let log = "./a.tex:1: First problem.\n./a.tex:9: Second problem.\n! Later.";
        assert_eq!(first_latex_error(log).as_deref(), Some("Line 1: First problem."));
    }

    #[test]
    fn first_latex_error_ignores_clock_times_and_warnings() {
        let log = "Started 16:24\nPackage hyperref Warning: Token not allowed on input line 12.\n";
        assert_eq!(first_latex_error(log), None);
    }

    #[test]
    fn compose_log_labels_sections_and_skips_empty_ones() {
        let output = ProcessOutput {
            success: false,
            code: Some(12),
            stdout: "Rc files read\n".into(),
            stderr: "  \n".into(),
            timed_out: false,
        };
        let log = compose_log(&output, "! Undefined control sequence.");
        assert_eq!(log, "--- latexmk ---\nRc files read\n\n--- LaTeX log ---\n! Undefined control sequence.");
    }

    #[test]
    fn compose_log_says_no_output_when_everything_is_empty() {
        let output = ProcessOutput { success: true, code: Some(0), stdout: String::new(), stderr: String::new(), timed_out: false };
        assert_eq!(compose_log(&output, ""), "No output.");
    }

    #[test]
    fn build_key_is_stable_case_insensitive_and_per_document() {
        let a = build_key(Path::new(r"C:\Docs\Thesis.tex"));
        assert_eq!(a, build_key(Path::new(r"c:\docs\thesis.tex")));
        assert_ne!(a, build_key(Path::new(r"C:\Docs\Other.tex")));
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn path_with_prefix_puts_tool_dirs_first() {
        let dirs = vec![PathBuf::from(r"C:\Lexy\miktex"), PathBuf::from(r"C:\Strawberry\perl\bin")];
        let joined = path_with_prefix(&dirs).unwrap();
        let parts: Vec<PathBuf> = env::split_paths(&joined).collect();
        assert_eq!(&parts[..2], dirs.as_slice());
    }

    #[test]
    fn export_pdf_copies_the_build_pdf_next_to_the_document() {
        let build = TempDir::new("export-build");
        let project = TempDir::new("export-project");
        let pdf = build.0.join("abc").join("Thesis.pdf");
        fs::create_dir_all(pdf.parent().unwrap()).unwrap();
        fs::write(&pdf, b"%PDF-1.5 new").unwrap();
        let document = project.0.join("Thesis.tex");
        fs::write(project.0.join("Thesis.pdf"), b"%PDF-1.5 old").unwrap();

        let saved = export_pdf_to(&build.0, &pdf.display().to_string(), &document.display().to_string()).unwrap();
        assert_eq!(PathBuf::from(&saved), project.0.join("Thesis.pdf"));
        assert_eq!(fs::read(project.0.join("Thesis.pdf")).unwrap(), b"%PDF-1.5 new");
        let names: Vec<_> = fs::read_dir(&project.0).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("Thesis.pdf")], "no temp files left behind");
    }

    #[test]
    fn export_pdf_only_copies_lexy_build_output_to_tex_documents() {
        let build = TempDir::new("export-guard");
        let outside = TempDir::new("export-outside");
        let stray = outside.0.join("secret.pdf");
        fs::write(&stray, b"%PDF").unwrap();
        let document = outside.0.join("doc.tex").display().to_string();
        assert!(export_pdf_to(&build.0, &stray.display().to_string(), &document).is_err());

        let pdf = build.0.join("x.pdf");
        fs::write(&pdf, b"%PDF").unwrap();
        assert!(export_pdf_to(&build.0, &pdf.display().to_string(), &outside.0.join("doc.txt").display().to_string()).is_err());
        assert!(!outside.0.join("doc.pdf").exists());
    }

    #[test]
    fn validate_pdf_path_accepts_pdfs_inside_the_build_root() {
        let root = TempDir::new("pdf-root");
        let pdf = root.0.join("abc").join("main.pdf");
        fs::create_dir_all(pdf.parent().unwrap()).unwrap();
        fs::write(&pdf, b"%PDF-1.5").unwrap();
        assert!(validate_pdf_path(&pdf.display().to_string(), &root.0).is_ok());
    }

    #[test]
    fn validate_pdf_path_rejects_outside_traversal_and_non_pdf() {
        let root = TempDir::new("pdf-root2");
        let outside = TempDir::new("pdf-outside");
        let stray = outside.0.join("secret.pdf");
        fs::write(&stray, b"%PDF").unwrap();
        let log = root.0.join("main.log");
        fs::write(&log, b"log").unwrap();
        let sneaky = root.0.join("..").join(outside.0.file_name().unwrap()).join("secret.pdf");

        assert!(validate_pdf_path(&stray.display().to_string(), &root.0).is_err());
        assert!(validate_pdf_path(&sneaky.display().to_string(), &root.0).is_err());
        assert!(validate_pdf_path(&log.display().to_string(), &root.0).is_err());
        assert!(validate_pdf_path(&root.0.join("none.pdf").display().to_string(), &root.0).is_err());
    }

    #[cfg(windows)]
    fn cmd(args: &[&str]) -> Command {
        let mut command = Command::new(cmd_exe());
        command.args(args);
        command
    }

    #[cfg(windows)]
    #[test]
    fn run_with_timeout_captures_stdout_stderr_and_exit_code() {
        let output = run_with_timeout(cmd(&["/C", "echo out & echo err 1>&2 & exit 4"]), Duration::from_secs(20)).unwrap();
        assert!(!output.success);
        assert_eq!(output.code, Some(4));
        assert!(output.stdout.contains("out"));
        assert!(output.stderr.contains("err"));
        assert!(!output.timed_out);
    }

    #[cfg(windows)]
    #[test]
    fn run_with_timeout_kills_the_whole_process_tree() {
        let started = Instant::now();
        // cmd → ping: a parent with a long-running child, like latexmk → pdflatex.
        let output = run_with_timeout(cmd(&["/C", "ping -n 30 127.0.0.1 >NUL"]), Duration::from_millis(500)).unwrap();
        assert!(output.timed_out);
        assert!(!output.success);
        assert!(started.elapsed() < Duration::from_secs(10), "took {:?}", started.elapsed());
    }

    #[test]
    fn run_with_timeout_reports_missing_program() {
        let error = run_with_timeout(Command::new("lexy-no-such-program-9f3b"), Duration::from_secs(1)).err().unwrap();
        assert!(error.contains("failed to start"), "{error}");
    }

    // ----- compile -----

    #[test]
    fn marker_engine_reads_texworks_convention() {
        assert_eq!(marker_engine("% !TEX program = xelatex\n\\documentclass{article}"), Some(Engine::Xelatex));
        assert_eq!(marker_engine("%!TEX TS-program = lualatex"), Some(Engine::Lualatex));
        assert_eq!(marker_engine("  % !tex PROGRAM=XeLaTeX  "), Some(Engine::Xelatex));
        assert_eq!(marker_engine("a\nb\nc\nd\n% !TEX program = xelatex"), Some(Engine::Xelatex));
        assert_eq!(marker_engine("% !TEX program = pdflatex"), Some(Engine::Pdflatex));
    }

    #[test]
    fn marker_engine_is_none_without_a_known_marker() {
        assert_eq!(marker_engine("\\documentclass{article}"), None);
        assert_eq!(marker_engine("% !TEX program = context"), None);
        assert_eq!(marker_engine("a\nb\nc\nd\ne\n% !TEX program = xelatex"), None);
        assert_eq!(marker_engine("% !TEX root = main.tex"), None);
        assert_eq!(marker_engine("text % !TEX program = xelatex"), None);
    }

    // ----- engine choice (spec 005, US1) -----

    fn engine(main: &str) -> (Engine, String) {
        choose_engine(main, &[])
    }

    #[test]
    fn engine_marker_wins_over_packages() {
        let text = "% !TEX program = lualatex\n\\documentclass{article}\n\\usepackage{latexbangla}\n";
        assert_eq!(engine(text), (Engine::Lualatex, "marker".into()));
        let pinned = "% !TEX program = pdflatex\n\\usepackage{fontspec}\n";
        assert_eq!(engine(pinned), (Engine::Pdflatex, "marker".into()));
    }

    #[test]
    fn engine_unicode_packages_and_classes_pick_xelatex() {
        assert_eq!(engine("\\documentclass{article}\n\\usepackage{latexbangla}\n\\setbanglamainfont{Kalpurush}"), (Engine::Xelatex, "latexbangla".into()));
        assert_eq!(engine("\\documentclass{article}\n\\usepackage[hidelinks]{hyperref, fontspec}\n"), (Engine::Xelatex, "fontspec".into()));
        assert_eq!(engine("\\documentclass{article}\n\\RequirePackage{polyglossia}"), (Engine::Xelatex, "polyglossia".into()));
        assert_eq!(engine("\\documentclass[a4paper]{bookbangla}\n"), (Engine::Xelatex, "bookbangla".into()));
        assert_eq!(engine("\\documentclass{article}\\usepackage {unicode-math}"), (Engine::Xelatex, "unicode-math".into()));
    }

    #[test]
    fn engine_ignores_comments_body_and_lookalikes() {
        assert_eq!(engine("\\documentclass{article}\n%\\usepackage{fontspec}\n"), (Engine::Pdflatex, "default".into()));
        assert_eq!(engine("\\documentclass{article}\n\\usepackage{amsmath} % \\usepackage{fontspec}\n"), (Engine::Pdflatex, "default".into()));
        assert_eq!(engine("\\documentclass{article}\n\\begin{document}\n\\usepackage{fontspec}\n"), (Engine::Pdflatex, "default".into()));
        assert_eq!(engine("\\documentclass{article}\n\\usepackage{babel}\n"), (Engine::Pdflatex, "default".into()));
        assert_eq!(engine("\\documentclass{article}\n\\usepackagex{fontspec}\n"), (Engine::Pdflatex, "default".into()));
        assert_eq!(engine("\\documentclass{article}\n\\usepackage{fontspecial}\n"), (Engine::Pdflatex, "default".into()));
        // An escaped percent is text, not a comment.
        assert_eq!(engine("\\documentclass{article}\\newcommand{\\p}{50\\%}\\usepackage{fontspec}"), (Engine::Xelatex, "fontspec".into()));
    }

    #[test]
    fn engine_reads_preamble_files_the_main_document_inputs() {
        let main = "\\documentclass{article}\n\\input{preamble}\n\\begin{document}\n\\input{chapter}\n\\end{document}";
        assert_eq!(preamble_inputs(&preamble(main)), vec!["preamble.tex".to_string()]);
        assert_eq!(choose_engine(main, &["\\usepackage{polyglossia}".into()]), (Engine::Xelatex, "polyglossia".into()));
        assert_eq!(preamble_inputs("\\include{setup/fonts.tex}"), vec!["setup/fonts.tex".to_string()]);
    }

    // ----- summaries (US2, US5) -----

    #[test]
    fn font_summary_finds_fontspec_error_behind_metafont_noise() {
        let log = "! Transform components aren't all known.\n! Package fontspec Error:\n(fontspec)                The font \"MyBangla\" cannot be found; this may be\n(fontspec)                but does not have to be due to a corrupted font file.";
        assert_eq!(missing_font(log).as_deref(), Some("MyBangla"));
        let split = "(fontspec)                The font \"Kalpurus\"\n(fontspec)                cannot be found.";
        assert_eq!(missing_font(split).as_deref(), Some("Kalpurus"));
        assert_eq!(missing_font("! Undefined control sequence."), None);
    }

    #[test]
    fn package_summary_names_the_missing_package() {
        let log = "./main.tex:2: LaTeX Error: File `latexbangla.sty' not found.";
        assert_eq!(missing_package(log).as_deref(), Some("latexbangla"));
        assert_eq!(missing_package("! LaTeX Error: File `chapter.tex' not found."), None);
        assert_eq!(missing_package("! LaTeX Error: File `bookbangla.cls' not found."), Some("bookbangla".into()));
    }

    // ----- names (US4) -----

    #[test]
    fn snapshot_stem_keeps_safe_names_only() {
        assert_eq!(snapshot_stem("Thesis"), "Thesis");
        assert_eq!(snapshot_stem("My Paper"), "My Paper");
        assert_eq!(snapshot_stem("আমার প্রবন্ধ"), "document");
        assert_eq!(snapshot_stem("a&b"), "document");
        assert_eq!(snapshot_stem(" padded"), "document");
        assert!(is_plain_ascii(" ~Az09"));
        assert!(!is_plain_ascii("é"));
        assert!(!is_plain_ascii("tab\t"));
    }

    #[test]
    fn tex_project_path_links_non_ascii_roots_and_never_follows_the_link_on_cleanup() {
        let base = TempDir::new("junction");
        let ascii_root = base.0.join("plain");
        fs::create_dir_all(&ascii_root).unwrap();
        let out = base.0.join("out");
        fs::create_dir_all(&out).unwrap();
        assert_eq!(tex_project_path(&out, &ascii_root), (ascii_root.clone(), None));
        assert!(!out.join(ROOT_LINK).exists(), "no link for ASCII roots");

        let bangla = base.0.join("প্রকল্প");
        fs::create_dir_all(bangla.join("অধ্যায়")).unwrap();
        fs::write(bangla.join("x.tex"), "project file").unwrap();
        let (path, note) = tex_project_path(&out, &bangla);
        assert_eq!((path.clone(), note), (out.join(ROOT_LINK), None));
        assert_eq!(fs::read_to_string(path.join("x.tex")).unwrap(), "project file");
        assert_eq!(tex_project_path(&out, &bangla).0, out.join(ROOT_LINK), "reused");

        let other = base.0.join("অন্য");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("y.tex"), "other").unwrap();
        tex_project_path(&out, &other);
        assert!(out.join(ROOT_LINK).join("y.tex").is_file(), "replaced when the project changes");
        assert!(bangla.join("x.tex").is_file(), "replacing the link keeps the old project");

        mirror_folders(&other, &out);
        let _ = fs::remove_dir_all(out.join(OVERLAY));
        fs::remove_dir_all(&out).unwrap();
        assert!(other.join("y.tex").is_file(), "deleting the build folder must not follow the junction");
        assert!(bangla.join("x.tex").is_file());
    }

    #[test]
    fn build_root_falls_back_to_program_data_for_non_ascii_profiles() {
        let local = PathBuf::from(r"C:\Users\me\AppData\Local");
        assert_eq!(build_root_from(Some(local.clone()), None, None).unwrap(), local.join("Lexy").join("Build"));
        let bangla = PathBuf::from(r"C:\Users\সায়েদ\AppData\Local");
        let fallback = build_root_from(Some(bangla.clone()), Some(PathBuf::from(r"C:\ProgramData")), Some(PathBuf::from(r"C:\Users\সায়েদ"))).unwrap();
        assert!(fallback.starts_with(r"C:\ProgramData\Lexy\Build"));
        assert!(is_plain_ascii(&fallback.display().to_string()));
        assert_eq!(build_root_from(Some(bangla.clone()), None, None).unwrap(), bangla.join("Lexy").join("Build"));
        assert!(build_root_from(None, None, None).is_err());
    }

    #[test]
    fn engine_flags_match_latexmk() {
        assert_eq!(Engine::Pdflatex.latexmk_flag(), "-pdf");
        assert_eq!(Engine::Xelatex.latexmk_flag(), "-xelatex");
        assert_eq!(Engine::Lualatex.latexmk_flag(), "-lualatex");
    }

    /// A canonical project folder with `main.tex` and a `chapters` subfolder.
    fn project_dir(label: &str, main: &str) -> (TempDir, PathBuf) {
        let dir = TempDir::new(label);
        fs::create_dir_all(dir.0.join("chapters")).unwrap();
        fs::write(dir.0.join("main.tex"), main).unwrap();
        let root = fs::canonicalize(&dir.0).unwrap();
        (dir, root)
    }

    fn buffer(path: &str, text: &str) -> Buffer {
        Buffer { path: path.into(), text: text.into() }
    }

    #[test]
    fn compile_project_writes_snapshot_and_overlay_and_never_touches_the_project() {
        let build = TempDir::new("proj-build");
        let (dir, root) = project_dir("proj-src", "saved main");
        fs::write(dir.0.join("chapters").join("intro.tex"), "saved intro").unwrap();
        fs::create_dir_all(dir.0.join(".git")).unwrap();
        let before = fs::metadata(dir.0.join("main.tex")).unwrap().modified().unwrap();

        // Runs latexmk if tools exist; either way the files are written first.
        let _ = compile_project_at(&build.0, &root, "main.tex", &[buffer("chapters/intro.tex", "unsaved intro")]);

        assert_eq!(fs::read_to_string(dir.0.join("main.tex")).unwrap(), "saved main");
        assert_eq!(fs::metadata(dir.0.join("main.tex")).unwrap().modified().unwrap(), before);
        assert_eq!(fs::read_to_string(dir.0.join("chapters").join("intro.tex")).unwrap(), "saved intro");
        let out = build.0.join(build_key(&PathBuf::from(project::display_path(&root.join("main.tex")))));
        assert_eq!(fs::read_to_string(out.join("main.tex")).unwrap(), "saved main");
        assert_eq!(fs::read_to_string(out.join(OVERLAY).join("chapters").join("intro.tex")).unwrap(), "unsaved intro");
        assert!(out.join("chapters").is_dir(), "folders are mirrored for \\include");
        assert!(!out.join(".git").exists(), "hidden folders are not mirrored");

        // A later compile without buffers clears the overlay; an unsaved main wins over disk.
        let _ = compile_project_at(&build.0, &root, "main.tex", &[buffer("main.tex", "unsaved main")]);
        assert!(!out.join(OVERLAY).join("chapters").exists());
        assert_eq!(fs::read_to_string(out.join("main.tex")).unwrap(), "unsaved main");
    }

    #[test]
    fn compile_project_validates_paths_and_sizes() {
        let build = TempDir::new("proj-bad");
        let (_dir, root) = project_dir("proj-bad-src", "x");
        let kind = |result: Result<CompileResult, project::ProjectError>| result.unwrap_err().kind;
        assert_eq!(kind(compile_project_at(&build.0, &root, "..\\main.tex", &[])), project::ErrorKind::OutsideProject);
        assert_eq!(kind(compile_project_at(&build.0, &root, "notes.txt", &[])), project::ErrorKind::InvalidName);
        assert_eq!(kind(compile_project_at(&build.0, &root, "gone.tex", &[])), project::ErrorKind::NotFound);
        assert_eq!(kind(compile_project_at(&build.0, &root, "main.tex", &[buffer("..\\x.tex", "")])), project::ErrorKind::OutsideProject);
        assert_eq!(kind(compile_project_at(&build.0, &root, "main.tex", &[buffer("run.bat", "")])), project::ErrorKind::InvalidName);
        let huge = "x".repeat(MAX_DOCUMENT_BYTES as usize + 1);
        assert_eq!(kind(compile_project_at(&build.0, &root, "main.tex", &[buffer("main.tex", &huge)])), project::ErrorKind::Io);
        assert_eq!(fs::read_dir(&build.0).unwrap().count(), 0, "nothing written for rejected compiles");
    }

    /// Real end-to-end compiles; skipped on machines without MiKTeX + latexmk + Perl.
    #[test]
    fn sync_round_trip_when_tools_are_installed() {
        if !detect_environment().ready {
            eprintln!("skipping: LaTeX tools not installed");
            return;
        }
        let build = TempDir::new("sync-build");
        for (label, header) in [("sync-pdf", ""), ("sync-xe", "% !TEX program = xelatex\n")] {
            let main = format!("{header}\\documentclass{{article}}\n\\begin{{document}}\nMain first paragraph.\n\n\\newpage\n\\input{{chapters/intro}}\n\\end{{document}}\n");
            let (dir, root) = project_dir(label, &main);
            fs::write(dir.0.join("chapters").join("intro.tex"), "Intro line one.\n\nIntro paragraph on page two.\n").unwrap();
            let mut result = compile_project_at(&build.0, &root, "main.tex", &[]).unwrap();
            assert!(result.ok, "{}\n{}", result.summary, result.log);
            let shown = result.shown.take().expect("shown slot");
            assert!(shown.pdf.ends_with(Path::new(sync::SHOWN).join("main.pdf")) && shown.pdf.is_file());
            assert!(shown.pdf.with_extension("synctex.gz").is_file(), "synctex data next to the shown PDF");
            if shown.synctex_exe.is_none() {
                eprintln!("skipping lookups: synctex.exe not found");
                return;
            }
            let spot = sync::to_pdf(&shown, "chapters/intro.tex", 3).unwrap().expect("intro line has a PDF spot");
            assert_eq!(spot.page, 2, "{label}");
            match sync::to_source(&shown, spot.page, spot.x + 1.0, spot.y + spot.height / 2.0).unwrap() {
                Some(sync::SyncTarget::Project { file, line }) => {
                    assert_eq!(file, "chapters/intro.tex", "{label}");
                    assert!((2..=4).contains(&line), "{label}: line {line}");
                }
                other => panic!("{label}: {other:?}"),
            }
            let spot = sync::to_pdf(&shown, "main.tex", 3).unwrap().expect("main line has a PDF spot");
            assert_eq!(spot.page, 1);

            // An unsaved buffer (overlay) round-trips too; a failed compile keeps the slot.
            let unsaved = buffer("chapters\\intro.tex", "Changed intro.\n\nUnsaved paragraph.\n");
            let mut result = compile_project_at(&build.0, &root, "main.tex", &[unsaved]).unwrap();
            let overlay_shown = result.shown.take().expect("shown slot");
            assert!(sync::to_pdf(&overlay_shown, "chapters/intro.tex", 3).unwrap().is_some(), "{label}: overlay lookup");
            let before = fs::read(&shown.pdf).unwrap();
            let failed = compile_project_at(&build.0, &root, "main.tex", &[buffer("chapters\\intro.tex", "Text\n\n\\foo\n")]).unwrap();
            assert!(!failed.ok && failed.shown.is_none(), "{label}: {}
{}", failed.summary, &failed.log[failed.log.len().saturating_sub(1500)..]);
            assert_eq!(fs::read(&shown.pdf).unwrap(), before, "a failed compile must not touch the shown PDF");
            let problem = failed.problems.iter().find(|p| p.severity == sync::Severity::Error).expect("an error");
            assert_eq!((problem.file.as_deref(), problem.line), (Some("chapters/intro.tex"), Some(3)), "{:?}", failed.problems);
        }
    }

    #[test]
    fn bangla_without_setup_compiles_and_purno_makes_it_portable() {
        if !detect_environment().ready {
            eprintln!("skipping: LaTeX tools not installed");
            return;
        }
        // The user's document from the bug report: Bangla text, no font packages.
        let doc = "\\documentclass{article}\n\n\\title{Untitled}\n\\author{fsdfsdfsdfs}\n\\date{\\today}\n\n\\begin{document}\n\n\\maketitle\n\n\\section{Intrxzczxcoduction}\n\nStart writing here. sdvvsdvsdv svsddsfds fdsfsadfsdfsadফসদফদফ দ্ভস্ফাস্ফদ \n\n\\end{document}\n";
        let build = TempDir::new("bangla-build");
        let (dir, root) = project_dir("bangla-auto", doc);
        let result = compile_project_at(&build.0, &root, "main.tex", &[]).unwrap();
        assert!(result.ok, "{}\n{}", result.summary, result.log);
        assert_eq!(result.engine, Engine::Xelatex);
        assert_eq!(result.auto_font.as_deref(), Some(bangla::SYSTEM_FONT));
        assert!(result.log.contains("Bangla text without a font setup"), "{}", &result.log[..200.min(result.log.len())]);
        assert_eq!(fs::read_to_string(dir.0.join("main.tex")).unwrap(), doc, "the user's file is untouched");

        // Portable setup: BCC Purno in fonts/ plus the block the UI writes (src/latex/scriptFont.ts).
        let local = env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap();
        let cache = local.join("Lexy").join("Fonts").join("BCCPurno");
        fs::create_dir_all(&cache).unwrap();
        for (name, remote, sha) in bangla::PURNO_FILES {
            // Fails loudly: a silent skip once hid a TLS bug. Set LEXY_OFFLINE=1 to skip without a network.
            if let Err(error) = setup::download(&format!("https://kriti.app/fonts/{remote}"), &cache.join(name), Some(sha), &mut |_, _| {}) {
                if env::var_os("LEXY_OFFLINE").is_some() {
                    eprintln!("skipping the portable part: {error}");
                    return;
                }
                panic!("downloading {name} failed: {error}");
            }
        }
        bangla::copy_purno(&cache, &dir.0).unwrap();
        let portable = doc.replacen(
            "\\documentclass{article}\n",
            "% !TEX program = xelatex\n\\documentclass{article}\n% --- Lexy Bangla font (BCC Purno in fonts/) ---\n\\usepackage{fontspec}\n\\setmainfont{BCCPurno}[Path=fonts/, Extension=.ttf, Script=Bengali, UprightFont=*-Regular, BoldFont=*-Bold, ItalicFont=*-Italic, BoldItalicFont=*-BoldItalic]\n% --- end Lexy Bangla font ---\n",
            1,
        );
        fs::write(dir.0.join("main.tex"), &portable).unwrap();
        let result = compile_project_at(&build.0, &root, "main.tex", &[]).unwrap();
        assert!(result.ok, "{}\n{}", result.summary, result.log);
        assert_eq!((result.engine, result.auto_font.as_deref()), (Engine::Xelatex, None));
        let log = fs::read_to_string(Path::new(result.pdf_path.as_deref().unwrap()).parent().and_then(Path::parent).unwrap().join("main.log")).unwrap();
        assert!(log.contains("BCCPurno-Regular.ttf"), "the project font must be used");
        assert!(!log.contains("Missing character"), "every Bangla glyph must be in the font");
    }

    /// Conjuncts must be shaped: the width of ক্ষ is less than ক + ্ + ষ drawn separately.
    #[test]
    fn bangla_conjuncts_are_shaped_with_both_font_setups() {
        if !detect_environment().ready {
            eprintln!("skipping: LaTeX tools not installed");
            return;
        }
        let probe = "\\setbox0\\hbox{ক্ষ}\\setbox2\\hbox{ক}\\setbox4\\hbox{্}\\setbox6\\hbox{ষ}\\typeout{LEXYW \\the\\wd0 \\the\\wd2 \\the\\wd4 \\the\\wd6 LEXYW}\nবাংলা ক্ষমা\n";
        let auto = format!("\\documentclass{{article}}\n\\begin{{document}}\n{probe}\\end{{document}}\n");
        let local = env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap();
        let cache = local.join("Lexy").join("Fonts").join("BCCPurno");
        let build = TempDir::new("shape-build");
        let mut cases = vec![("shape-auto", auto.clone(), false)];
        let portable = auto.replacen(
            "\\documentclass{article}\n",
            "\\documentclass{article}\n\\usepackage{fontspec}\n\\setmainfont{BCCPurno}[Path=fonts/, Extension=.ttf, Script=Bengali, UprightFont=*-Regular, BoldFont=*-Bold, ItalicFont=*-Italic, BoldItalicFont=*-BoldItalic]\n",
            1,
        );
        if cache.join("BCCPurno-Regular.ttf").is_file() {
            cases.push(("shape-purno", portable, true));
        } else {
            eprintln!("BCC Purno not cached; checking the automatic font only");
        }
        for (label, text, purno) in cases {
            let (dir, root) = project_dir(label, &text);
            if purno {
                bangla::copy_purno(&cache, &dir.0).unwrap();
            }
            let result = compile_project_at(&build.0, &root, "main.tex", &[]).unwrap();
            assert!(result.ok, "{label}: {}\n{}", result.summary, result.log);
            let out = Path::new(result.pdf_path.as_deref().unwrap()).parent().and_then(Path::parent).unwrap().to_path_buf();
            let log = fs::read_to_string(out.join("main.log")).unwrap().replace(['\r', '\n'], "");
            let start = log.find("LEXYW ").expect("width probe in the log") + 6;
            let end = start + log[start..].find("LEXYW").unwrap();
            // TeX eats the spaces after each \the\wd, so the values arrive as 10.0pt8.7pt…
            let widths: Vec<f64> = log[start..end].split("pt").map(str::trim).filter(|w| !w.is_empty()).map(|w| w.parse().unwrap()).collect();
            let separate = widths[1] + widths[2] + widths[3];
            assert!(widths[0] + 0.5 < separate, "{label}: ক্ষ is {}pt, separate letters {separate}pt: conjunct not shaped", widths[0]);
        }
    }

    /// Review → Export PDF with notes writes `main (notes).pdf` and never touches the preview's build folder.
    #[test]
    fn pdf_with_notes_when_tools_are_installed() {
        if !detect_environment().ready {
            eprintln!("skipping: LaTeX tools not installed");
            return;
        }
        let build = TempDir::new("e2e-notes");
        let (dir, root) = project_dir("e2e-notes-project", "\\documentclass{article}\\begin{document}Text.\\end{document}\n");
        let noted = "\\documentclass{article}\n\\usepackage{todonotes}\n\\begin{document}Text.\\todo{check this}\\end{document}\n";
        let name = export_pdf_with_notes_at(&build.0, &root, "main.tex", &[buffer("main.tex", noted)]).unwrap();
        assert_eq!(name, "main (notes).pdf");
        assert!(fs::read(dir.0.join("main (notes).pdf")).unwrap().starts_with(b"%PDF"));
        assert!(!build.0.join(build_key(Path::new(&project::display_path(&root.join("main.tex"))))).exists(), "the preview's build folder stays untouched");
        assert_eq!(fs::read_to_string(dir.0.join("main.tex")).unwrap(), "\\documentclass{article}\\begin{document}Text.\\end{document}\n");
    }

    /// Every New project template compiles unchanged (spec 007 SC-006).
    #[test]
    fn every_template_compiles_when_tools_are_installed() {
        if !detect_environment().ready {
            eprintln!("skipping: LaTeX tools not installed");
            return;
        }
        let build = TempDir::new("e2e-templates");
        let templates = [
            ("article", include_str!("../../src/templates/article.tex")),
            ("report", include_str!("../../src/templates/report.tex")),
            ("letter", include_str!("../../src/templates/letter.tex")),
            ("cv", include_str!("../../src/templates/cv.tex")),
            ("beamer", include_str!("../../src/templates/beamer.tex")),
        ];
        for (name, text) in templates {
            let (_dir, root) = project_dir(&format!("e2e-template-{name}"), text);
            let result = compile_project_at(&build.0, &root, "main.tex", &[]).unwrap();
            assert!(result.ok, "{name}: {}\n{}", result.summary, result.log.chars().rev().take(3000).collect::<String>().chars().rev().collect::<String>());
            assert!(result.problems.iter().all(|problem| problem.severity != sync::Severity::Error), "{name}: {:?}", result.problems);
        }
    }

    #[test]
    fn compile_end_to_end_when_tools_are_installed() {
        if !detect_environment().ready {
            eprintln!("skipping: LaTeX tools not installed");
            return;
        }
        let build = TempDir::new("e2e-build");

        let (_good, root) = project_dir("e2e-good", "\\documentclass{article}\\begin{document}Hi\\end{document}\n");
        let result = compile_project_at(&build.0, &root, "main.tex", &[]).unwrap();
        assert!(result.ok, "{}\n{}", result.summary, result.log);
        assert_eq!(result.engine, Engine::Pdflatex);
        assert!(fs::read(result.pdf_path.expect("pdf path")).unwrap().starts_with(b"%PDF"));

        let (_bad, root) = project_dir("e2e-bad", "\\documentclass{article}\n\\begin{document}\n\\foo\n\\end{document}\n");
        let result = compile_project_at(&build.0, &root, "main.tex", &[]).unwrap();
        assert!(!result.ok);
        assert_eq!(result.summary, "Line 3: Undefined control sequence.");
        assert!(result.pdf_path.is_none());

        // Multi-file project: unsaved \input buffer, saved \include, an image and a .bib, all
        // read from the project (research R1); nothing copied, nothing written beside the files.
        let main = "\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\input{chapters/intro}\n\\include{chapters/two}\n\\includegraphics[width=1cm]{fig.png}\n\\cite{knuth}\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n";
        let (dir, root) = project_dir("e2e-multi", main);
        fs::write(dir.0.join("chapters").join("intro.tex"), "SAVEDINTRO\n").unwrap();
        fs::write(dir.0.join("chapters").join("two.tex"), "Chapter two.\n").unwrap();
        fs::write(dir.0.join("refs.bib"), "@book{knuth, author={Knuth}, title={TeX}, year={1984}, publisher={AW}}\n").unwrap();
        // 1x1 PNG.
        let png: [u8; 67] = [
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
            0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49,
            0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00,
            0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        fs::write(dir.0.join("fig.png"), png).unwrap();
        let before: Vec<_> = fs::read_dir(&dir.0).unwrap().flatten().map(|e| e.file_name()).collect();
        let result = compile_project_at(&build.0, &root, "main.tex", &[buffer("chapters\\intro.tex", "UNSAVEDINTRO\n")]).unwrap();
        assert!(result.ok, "multi-file compile failed: {}\n{}", result.summary, result.log);
        let out = Path::new(result.pdf_path.as_deref().unwrap()).parent().and_then(Path::parent).unwrap().to_path_buf();
        // TeX wraps log lines at 79 characters, so join them before searching.
        let log = fs::read_to_string(out.join("main.log")).unwrap_or_default().replace(['\r', '\n'], "");
        assert!(log.contains(".lexy-overlay"), "the unsaved intro must come from the overlay:\n{log}");
        assert!(!out.join("fig.png").exists(), "images are read from the project, not copied");
        assert_eq!(fs::read_to_string(dir.0.join("chapters").join("intro.tex")).unwrap(), "SAVEDINTRO\n");
        let after: Vec<_> = fs::read_dir(&dir.0).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(before, after, "aux files must not land in the project");

        // System font through XeLaTeX + fontspec.
        let xe = "% !TEX program = xelatex\n\\documentclass{article}\n\\usepackage{fontspec}\n\\setmainfont{Arial}\n\\begin{document}Arial text\\end{document}\n";
        let (_xe, root) = project_dir("e2e-xe", xe);
        let result = compile_project_at(&build.0, &root, "main.tex", &[]).unwrap();
        assert_eq!(result.engine, Engine::Xelatex);
        assert!(result.ok, "XeLaTeX failed: {}\n{}", result.summary, result.log);

        // Bangla names (spec 005 US4): project, main and chapter in Bangla, pdfLaTeX, exported by real name.
        let names = TempDir::new("e2e-names");
        let bangla_root = names.0.join("প্রকল্প");
        fs::create_dir_all(bangla_root.join("অধ্যায়")).unwrap();
        fs::write(bangla_root.join("অধ্যায়").join("ভূমিকা.tex"), "Chapter from a Bangla folder.\n").unwrap();
        fs::write(bangla_root.join("আমার প্রবন্ধ.tex"), "\\documentclass{article}\\begin{document}\\input{অধ্যায়/ভূমিকা}\\end{document}\n").unwrap();
        let bangla_root = fs::canonicalize(&bangla_root).unwrap();
        let result = compile_project_at(&build.0, &bangla_root, "আমার প্রবন্ধ.tex", &[]).unwrap();
        assert!(result.ok, "Bangla names failed: {}\n{}", result.summary, result.log);
        let pdf = result.pdf_path.unwrap();
        assert!(pdf.ends_with("document.pdf"), "{pdf}");
        let main_abs = project::display_path(&bangla_root.join("আমার প্রবন্ধ.tex"));
        let exported = export_pdf_to(&build.0, &pdf, &main_abs).unwrap();
        assert!(exported.ends_with("আমার প্রবন্ধ.pdf"), "{exported}");

        if !bangla_font_installed() {
            eprintln!("skipping Bangla font cases: no Kalpurush or Siyam Rupali installed");
            return;
        }
        // The reported failure (US1): LaTeXbangla without an engine line compiles with XeLaTeX.
        let family = if Path::new(r"C:\Windows\Fonts\kalpurush.ttf").exists() { "Kalpurush" } else { "Siyam Rupali" };
        let bangla = format!("\\documentclass{{article}}\n\\usepackage{{latexbangla}}\n\\setbanglamainfont{{{family}}}\n\\begin{{document}}\nবাংলা ও English একই অনুচ্ছেদে। ক্ষ\n\\end{{document}}\n");
        let (_bn, root) = project_dir("e2e-bangla", &bangla);
        let result = compile_project_at(&build.0, &root, "main.tex", &[]).unwrap();
        assert_eq!(result.engine, Engine::Xelatex);
        assert!(result.ok, "LaTeXbangla failed: {}\n{}", result.summary, result.log);
        assert!(result.log.starts_with("Engine: XeLaTeX (latexbangla)"), "{}", &result.log[..80.min(result.log.len())]);

        // A font file kept only in the project (US2), and a missing font's summary.
        let font_file = bangla_font_file().expect("font file");
        let local = "\\documentclass{article}\n\\usepackage{latexbangla}\n\\setbanglamainfont{MyBangla.ttf}[Path=fonts/]\n\\begin{document}\nবাংলা\n\\end{document}\n";
        let (font_dir, root) = project_dir("e2e-font", local);
        fs::create_dir_all(font_dir.0.join("fonts")).unwrap();
        fs::copy(&font_file, font_dir.0.join("fonts").join("MyBangla.ttf")).unwrap();
        let result = compile_project_at(&build.0, &root, "main.tex", &[]).unwrap();
        assert!(result.ok, "project font failed: {}\n{}", result.summary, result.log);
        let missing = local.replace("MyBangla.ttf}[Path=fonts/]", "NoSuchFont}");
        let result = compile_project_at(&build.0, &root, "main.tex", &[buffer("main.tex", &missing)]).unwrap();
        assert!(!result.ok);
        assert_eq!(result.summary, "Font \"NoSuchFont\" not found");
    }

    /// A tested Bangla font installed for all users or the current user (e2e cases skip otherwise).
    fn bangla_font_file() -> Option<PathBuf> {
        let mut dirs = vec![PathBuf::from(r"C:\Windows\Fonts")];
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join(r"Microsoft\Windows\Fonts"));
        }
        dirs.iter()
            .flat_map(|dir| ["kalpurush.ttf", "Siyamrupali.ttf"].map(|name| dir.join(name)))
            .find(|path| path.is_file())
    }

    fn bangla_font_installed() -> bool {
        bangla_font_file().is_some()
    }

    // ----- default folder -----

    #[test]
    fn lexy_folder_creates_documents_lexy() {
        let docs = TempDir::new("folder-docs");
        let folder = lexy_folder::<String>(Ok(docs.0.clone()), None).unwrap();
        assert_eq!(folder, DefaultFolder { path: docs.0.join("Lexy").display().to_string(), fallback: false });
        assert!(docs.0.join("Lexy").is_dir());
        // Second call with the folder already there is fine.
        assert!(!lexy_folder::<String>(Ok(docs.0.clone()), None).unwrap().fallback);
    }

    #[test]
    fn lexy_folder_falls_back_to_home() {
        let home = TempDir::new("folder-home");
        let folder = lexy_folder(Err("no documents"), Some(home.0.clone())).unwrap();
        assert_eq!(folder, DefaultFolder { path: home.0.display().to_string(), fallback: true });
    }

    #[test]
    fn lexy_folder_falls_back_when_documents_is_not_creatable() {
        let home = TempDir::new("folder-home2");
        let blocker = TempDir::new("folder-blocker");
        let file = blocker.0.join("not-a-dir");
        fs::write(&file, b"").unwrap();
        let folder = lexy_folder::<String>(Ok(file), Some(home.0.clone())).unwrap();
        assert!(folder.fallback);
    }

    #[test]
    fn lexy_folder_errors_without_documents_or_home() {
        assert!(lexy_folder(Err("no documents"), None).is_err());
    }

    // ----- fonts -----

    #[test]
    fn is_valid_family_blocks_latex_specials() {
        for ok in ["Arial", "Times New Roman", "Segoe UI", "Noto Sans CJK-JP", "D'Nealian", "AT&T Font", "Font_1.0+"] {
            assert!(is_valid_family(ok), "{ok}");
        }
        for bad in ["", "Evil}\\input{x", "50%", "C#", "Tab\tName", "Ünïcode", &"x".repeat(65)] {
            assert!(!is_valid_family(bad), "{bad}");
        }
    }

    #[test]
    fn filter_families_sorts_dedups_and_drops_invalid() {
        let names = ["Georgia", "arial", "Arial", " Calibri ", "Bad{Name}", "Cambria"].map(String::from);
        assert_eq!(filter_families(names), vec!["arial", "Calibri", "Cambria", "Georgia"]);
    }

    #[test]
    fn system_fonts_load_on_this_machine() {
        let mut database = fontdb::Database::new();
        database.load_system_fonts();
        let families = filter_families(database.faces().flat_map(|f| f.families.iter().map(|(n, _)| n.clone())));
        if cfg!(windows) {
            assert!(families.iter().any(|f| f == "Arial"), "expected Arial among {} families", families.len());
        }
    }

    #[test]
    fn default_folder_serializes_camel_case() {
        let json = serde_json::to_value(DefaultFolder { path: "C:\\x".into(), fallback: true }).unwrap();
        assert_eq!(json, serde_json::json!({ "path": "C:\\x", "fallback": true }));
    }

    #[test]
    fn compile_result_serializes_pdf_path_in_camel_case() {
        let json = serde_json::to_value(CompileResult {
            ok: true,
            summary: "PDF ready".into(),
            log: String::new(),
            pdf_path: Some("C:\\x.pdf".into()),
            engine: Engine::Xelatex,
            problems: vec![sync::Problem { severity: sync::Severity::Error, file: Some("a.tex".into()), line: Some(2), message: "x".into() }],
            auto_font: None,
            shown: None,
            tools_dir: None,
        })
        .unwrap();
        assert_eq!(json["problems"][0]["file"], "a.tex");
        assert!(json.get("shown").is_none() && json.get("toolsDir").is_none());
        assert_eq!(json["pdfPath"], "C:\\x.pdf");
        assert!(json.get("pdf_path").is_none());
    }

}
