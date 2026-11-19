//! Word/HTML export through Pandoc (spec 007 US7, research R16). Pandoc is downloaded on first
//! use only after the user agrees (pinned version and SHA-256, visible progress), into
//! %LOCALAPPDATA%\Lexy\Tools\Pandoc. Exports read the saved main document and write
//! `<stem>.docx` / `<stem>.html` beside it.

use serde::Serialize;
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};

use crate::{
    project::{self, ErrorKind, ProjectError, ProjectState},
    run_with_timeout,
    setup::{download, extract_zip},
};

/// 3.13 (2026-10-26); the SHA-256 is GitHub's published asset digest.
pub const PANDOC_VERSION: &str = "3.13";
const PANDOC_URL: &str = "https://github.com/jgm/pandoc/releases/download/3.13/pandoc-3.13-windows-x86_64.zip";
const PANDOC_SHA256: &str = "23e1f2e978a3df80db8bf65c9c59534f41a23140480cfb4f783a882ab7dc6a4e";
pub const PANDOC_BYTES: u64 = 42_983_200;
const EXPORT_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_WARNINGS: usize = 50;

/// One install at a time (managed state, not a global).
#[derive(Default)]
pub struct ConverterLock(pub Arc<Mutex<()>>);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConverterStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub download_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    /// File name written beside the main document.
    pub output: String,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    state: &'static str,
    bytes_done: u64,
    bytes_total: u64,
    detail: String,
}

fn tools_dir() -> Result<PathBuf, String> {
    std::env::var_os("LOCALAPPDATA")
        .map(|base| PathBuf::from(base).join("Lexy").join("Tools").join("Pandoc"))
        .ok_or_else(|| "LOCALAPPDATA is not set".to_string())
}

/// `pandoc.exe` of the pinned version inside `dir`, if installed.
pub fn pandoc_in(dir: &Path) -> Option<PathBuf> {
    let exe = dir.join(format!("pandoc-{PANDOC_VERSION}")).join("pandoc.exe");
    exe.is_file().then_some(exe)
}

/// Download `url` (checked against `sha256`) and unpack it into `dir`; the ZIP is removed afterwards.
pub fn install_at(dir: &Path, url: &str, sha256: &str, on_progress: &mut dyn FnMut(&'static str, u64, u64)) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|error| format!("Could not create {}: {error}", dir.display()))?;
    let zip = dir.join("pandoc.zip");
    download(url, &zip, Some(sha256), &mut |done, total| on_progress("downloading", done, total.unwrap_or(PANDOC_BYTES)))?;
    let unpacked = extract_zip(&zip, dir, &mut |done, total| on_progress("unpacking", done, total));
    let _ = fs::remove_file(&zip);
    unpacked?;
    pandoc_in(dir).ok_or_else(|| format!("The download did not contain pandoc-{PANDOC_VERSION}\\pandoc.exe"))
}

/// Pandoc's warnings, one per line, without the `[WARNING]` prefix.
pub fn parse_warnings(stderr: &str) -> Vec<String> {
    stderr
        .lines()
        .filter_map(|line| line.trim().strip_prefix("[WARNING]"))
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .take(MAX_WARNINGS)
        .collect()
}

/// Arguments for converting `main` (absolute) to `out` (absolute); `cites` turns on citeproc.
pub fn export_args(main: &Path, out: &Path, format: &str, root: &Path, cites: bool) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec![main.into(), "--from".into(), "latex".into(), "--to".into()];
    args.push(if format == "docx" { "docx" } else { "html5" }.into());
    args.extend(["--resource-path".into(), root.into(), "--output".into(), out.into()]);
    if format == "html" {
        args.extend(["--standalone".into(), "--mathml".into()]);
    }
    if cites {
        args.push("--citeproc".into());
    }
    args
}

/// Convert the saved main document; returns the output name and Pandoc's warnings.
pub fn export_at(pandoc: &Path, root: &Path, main: &str, format: &str) -> Result<ExportReport, ProjectError> {
    if format != "docx" && format != "html" {
        return Err(ProjectError::new(ErrorKind::InvalidName, format!("Can't export to {format}")));
    }
    let main_path = project::resolve_in_project(root, main)?;
    let text = project::read_file_at(root, main)?;
    let cites = text.contains("\\bibliography{") || text.contains("\\addbibresource");
    let name = format!("{}.{format}", main_path.file_stem().and_then(|stem| stem.to_str()).unwrap_or("document"));
    let out = main_path.with_file_name(&name);
    let plain = |path: &Path| PathBuf::from(project::display_path(path));
    let mut command = Command::new(pandoc);
    command.args(export_args(&plain(&main_path), &plain(&out), format, &plain(root), cites)).current_dir(plain(root));
    let output = run_with_timeout(command, EXPORT_TIMEOUT, &|| false).map_err(|error| ProjectError::new(ErrorKind::Io, error))?;
    if output.timed_out {
        return Err(ProjectError::new(ErrorKind::Io, "The export took longer than 2 minutes and was stopped."));
    }
    if !output.success || !out.is_file() {
        let tail: Vec<&str> = output.stderr.lines().rev().take(6).collect();
        let reason = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
        return Err(ProjectError::new(ErrorKind::Io, format!("The export failed. {}", reason.trim())));
    }
    Ok(ExportReport { output: name, warnings: parse_warnings(&output.stderr) })
}

#[tauri::command]
pub fn converter_status() -> Result<ConverterStatus, String> {
    let installed = pandoc_in(&tools_dir()?).is_some();
    Ok(ConverterStatus { installed, version: installed.then(|| PANDOC_VERSION.to_string()), download_bytes: PANDOC_BYTES })
}

/// Only called after the consent dialog; progress arrives as `converter-progress` events.
#[tauri::command]
pub async fn install_converter(app: AppHandle, lock: State<'_, ConverterLock>) -> Result<(), String> {
    let dir = tools_dir()?;
    let lock = Arc::clone(&lock.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if pandoc_in(&dir).is_some() {
            return Ok(());
        }
        let emit = |state: &'static str, done: u64, total: u64, detail: String| {
            let _ = app.emit("converter-progress", Progress { state, bytes_done: done, bytes_total: total, detail });
        };
        let result = install_at(&dir, PANDOC_URL, PANDOC_SHA256, &mut |state, done, total| emit(state, done, total, String::new()));
        match &result {
            Ok(_) => emit("done", PANDOC_BYTES, PANDOC_BYTES, String::new()),
            Err(error) => emit("error", 0, PANDOC_BYTES, error.clone()),
        }
        result.map(|_| ())
    })
    .await
    .map_err(|error| format!("install task failed: {error}"))?
}

#[tauri::command]
pub async fn export_document(state: State<'_, ProjectState>, main: String, format: String) -> Result<ExportReport, ProjectError> {
    let root = state.with(|project| Ok(project.root.clone()))?;
    let pandoc = tools_dir()
        .ok()
        .and_then(|dir| pandoc_in(&dir))
        .ok_or_else(|| ProjectError::new(ErrorKind::NotFound, "Pandoc is not installed yet"))?;
    tauri::async_runtime::spawn_blocking(move || export_at(&pandoc, &root, &main, &format))
        .await
        .map_err(|error| ProjectError::new(ErrorKind::Io, format!("export task failed: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    fn temp(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lexy-export-test-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::canonicalize(dir).unwrap()
    }

    fn serve(body: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            for stream in listener.incoming().take(2).flatten() {
                let mut stream = stream;
                let mut request = [0u8; 2048];
                let _ = stream.read(&mut request);
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(&body);
            }
        });
        format!("http://{address}/pandoc.zip")
    }

    fn fake_zip(entry: &str) -> Vec<u8> {
        let mut buffer = std::io::Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut buffer);
        zip.start_file(entry, zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(b"MZ fake").unwrap();
        zip.finish().unwrap();
        buffer.into_inner()
    }

    #[test]
    fn install_verifies_the_hash_unpacks_and_reports_progress() {
        let dir = temp("install");
        let body = fake_zip(&format!("pandoc-{PANDOC_VERSION}/pandoc.exe"));
        let sha = format!("{:x}", Sha256::digest(&body));
        let mut states = Vec::new();
        let exe = install_at(&dir, &serve(body), &sha, &mut |state, _, _| states.push(state)).unwrap();
        assert_eq!(exe, dir.join(format!("pandoc-{PANDOC_VERSION}")).join("pandoc.exe"));
        assert!(states.contains(&"downloading") && states.contains(&"unpacking"));
        assert!(!dir.join("pandoc.zip").exists(), "the ZIP is removed");
        assert_eq!(pandoc_in(&dir), Some(exe));
    }

    #[test]
    fn install_refuses_a_wrong_hash_and_an_unexpected_archive() {
        let dir = temp("install-bad");
        let body = fake_zip(&format!("pandoc-{PANDOC_VERSION}/pandoc.exe"));
        assert!(install_at(&dir, &serve(body), &"0".repeat(64), &mut |_, _, _| ()).is_err());
        assert!(pandoc_in(&dir).is_none());
        let other = fake_zip("something/else.exe");
        let sha = format!("{:x}", Sha256::digest(&other));
        assert!(install_at(&dir, &serve(other), &sha, &mut |_, _, _| ()).unwrap_err().contains("did not contain"));
    }

    #[test]
    fn arguments_and_warnings() {
        let args: Vec<String> = export_args(Path::new(r"C:\p\main.tex"), Path::new(r"C:\p\main.html"), "html", Path::new(r"C:\p"), true)
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args, [r"C:\p\main.tex", "--from", "latex", "--to", "html5", "--resource-path", r"C:\p", "--output", r"C:\p\main.html", "--standalone", "--mathml", "--citeproc"]);
        assert_eq!(parse_warnings("[WARNING] Could not convert TeX math \\foo\nok\n[WARNING]  Skipped tikzpicture \n"), ["Could not convert TeX math \\foo", "Skipped tikzpicture"]);
    }

    #[test]
    fn export_refuses_unknown_formats() {
        let dir = temp("format");
        assert_eq!(export_at(Path::new("pandoc.exe"), &dir, "main.tex", "pdf").unwrap_err().kind, ErrorKind::InvalidName);
    }

    /// Real conversion when Pandoc is installed (Lexy's copy, or on PATH); skips otherwise.
    #[test]
    fn exports_docx_and_html_when_pandoc_is_installed() {
        let pandoc = tools_dir().ok().and_then(|dir| pandoc_in(&dir)).or_else(|| {
            let found = Command::new("where").arg("pandoc").output().ok()?;
            String::from_utf8_lossy(&found.stdout).lines().next().map(PathBuf::from)
        });
        let Some(pandoc) = pandoc else {
            eprintln!("skipping: Pandoc not installed");
            return;
        };
        let dir = temp("real");
        fs::write(dir.join("main.tex"), "\\documentclass{article}\n\\begin{document}\n\\section{Intro}\nText with $x^2$.\n\\begin{itemize}\\item one\\end{itemize}\n\\end{document}\n").unwrap();
        let report = export_at(&pandoc, &dir, "main.tex", "docx").unwrap();
        assert_eq!(report.output, "main.docx");
        assert!(fs::read(dir.join("main.docx")).unwrap().starts_with(b"PK"));
        export_at(&pandoc, &dir, "main.tex", "html").unwrap();
        let html = fs::read_to_string(dir.join("main.html")).unwrap();
        assert!(html.contains("Intro") && html.contains("<math"), "{html}");
    }
}
