//! PDF ↔ source sync and compile problems (specs/003-pdf-source-sync). Every successful
//! compile is copied into a "shown" slot whose SyncTeX file the lookups read, so jumps always
//! match the PDF on screen. Paths TeX reports (snapshot, overlay, project, junction) map back
//! to project-relative files through one table.

use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::Duration,
};
use tauri::State;

use crate::{build_dir_for, find_on_path, project::ProjectState, run_with_timeout};

const LOOKUP_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_PROBLEMS: usize = 200;
const MAX_MESSAGE: usize = 300;
pub const SHOWN: &str = ".lexy-shown";

// ---------------------------------------------------------------------------
// Path table
// ---------------------------------------------------------------------------

/// Where TeX may have read a project file from, for one compile.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PathTable {
    /// Build folder; relative names in the log (`./main.tex`) are relative to it.
    pub base: PathBuf,
    pub main_snapshot: PathBuf,
    pub main_rel: String,
    pub overlay: PathBuf,
    /// The project root and, for non-ASCII roots, the `.lexy-root` junction.
    pub roots: Vec<PathBuf>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mapped {
    Project(String),
    External(String),
}

/// Lower-cased, `/`-separated, without `\\?\` and `./` segments.
fn norm(path: &str) -> String {
    let path = path.trim().trim_matches('"').replace('\\', "/");
    let path = path.strip_prefix("//?/").unwrap_or(&path);
    let mut out: Vec<&str> = Vec::new();
    for (index, part) in path.split('/').enumerate() {
        match part {
            "." => {}
            "" if index > 0 => {}
            ".." if out.len() > 1 => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out.join("/").to_lowercase()
}

fn is_absolute(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.starts_with('/') || path.starts_with('\\') || (bytes.len() > 1 && bytes[1] == b':')
}

impl PathTable {
    pub fn map(&self, path: &str) -> Mapped {
        let raw = path.trim().trim_matches('"');
        let full = if is_absolute(raw) { raw.to_string() } else { format!("{}/{}", self.base.display(), raw) };
        let full = norm(&full);
        let name = raw.rsplit(['/', '\\']).next().unwrap_or(raw).to_string();
        if full == norm(&self.main_snapshot.display().to_string()) {
            return Mapped::Project(self.main_rel.replace('\\', "/"));
        }
        // Keep the original case of the relative part: slice the raw path by the prefix length.
        let raw_norm = raw.replace('\\', "/");
        for prefix in std::iter::once(&self.overlay).chain(&self.roots) {
            let prefix = format!("{}/", norm(&prefix.display().to_string()));
            if let Some(rel) = full.strip_prefix(&prefix) {
                if rel.is_empty() {
                    break;
                }
                // Recover case from the end of the raw path (same length as `rel`).
                let tail = raw_norm.len().checked_sub(rel.len()).and_then(|start| raw_norm.get(start..));
                let rel = match tail {
                    Some(tail) if tail.eq_ignore_ascii_case(rel) || tail.to_lowercase() == rel => tail.to_string(),
                    _ => rel.to_string(),
                };
                return Mapped::Project(rel);
            }
        }
        Mapped::External(name)
    }
}

// ---------------------------------------------------------------------------
// Shown slot
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Shown {
    pub out_dir: PathBuf,
    pub pdf: PathBuf,
    pub table: PathTable,
    pub synctex_exe: Option<PathBuf>,
}

#[derive(Default)]
pub struct SyncState(Mutex<HashMap<PathBuf, Shown>>);

impl SyncState {
    pub fn store(&self, shown: Shown) {
        if let Ok(mut map) = self.0.lock() {
            map.insert(shown.out_dir.clone(), shown);
        }
    }

    fn get(&self, out_dir: &Path) -> Option<Shown> {
        self.0.lock().ok()?.get(out_dir).cloned()
    }
}

/// Copy the fresh PDF and SyncTeX file into the shown slot (temp name, then rename).
pub fn publish(out_dir: &Path, stem: &str) -> Result<PathBuf, String> {
    let slot = out_dir.join(SHOWN);
    std::fs::create_dir_all(&slot).map_err(|error| format!("failed to create {SHOWN}: {error}"))?;
    let mut pdf = slot.join(format!("{stem}.pdf"));
    for ext in ["synctex.gz", "pdf"] {
        let source = out_dir.join(format!("{stem}.{ext}"));
        let target = slot.join(format!("{stem}.{ext}"));
        if !source.is_file() {
            let _ = std::fs::remove_file(&target);
            continue;
        }
        let temp = slot.join(format!("{stem}.{ext}.tmp"));
        std::fs::copy(&source, &temp).map_err(|error| format!("failed to copy {ext}: {error}"))?;
        std::fs::rename(&temp, &target).map_err(|error| format!("failed to replace {ext}: {error}"))?;
        if ext == "pdf" {
            pdf = target;
        }
    }
    Ok(pdf)
}

/// `synctex.exe` ships beside MiKTeX's engines.
pub fn synctex_beside(tools_dir: Option<&Path>) -> Option<PathBuf> {
    tools_dir.map(|dir| dir.join("synctex.exe")).filter(|path| path.is_file()).or_else(|| find_on_path("synctex.exe"))
}

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Problem {
    pub severity: Severity,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub message: String,
}

const FILE_EXTENSIONS: [&str; 22] = [
    ".tex", ".sty", ".cls", ".cfg", ".def", ".clo", ".fd", ".bbl", ".aux", ".toc", ".ldf", ".out", ".nav", ".snm", ".bcf",
    ".lbx", ".dbx", ".cbx", ".bbx", ".ltx", ".dfu", ".lof",
];

fn looks_like_file(token: &str) -> bool {
    let lower = token.to_lowercase();
    !token.is_empty()
        && (token.starts_with("./")
            || token.starts_with("../")
            || token.starts_with('/')
            || lower.get(1..3).is_some_and(|s| s == ":/" || s == ":\\")
            || FILE_EXTENSIONS.iter().any(|ext| lower.ends_with(ext)))
}

/// Push a file (or a placeholder) for every `(`, pop for every `)`.
fn track_parens(line: &str, stack: &mut Vec<Option<String>>) {
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '(' => {
                let mut j = i + 1;
                let token: String = if chars.get(j) == Some(&'"') {
                    j += 1;
                    let start = j;
                    while j < chars.len() && chars[j] != '"' {
                        j += 1;
                    }
                    let token = chars[start..j].iter().collect();
                    j += 1;
                    token
                } else {
                    let start = j;
                    while j < chars.len() && !chars[j].is_whitespace() && chars[j] != '(' && chars[j] != ')' {
                        j += 1;
                    }
                    chars[start..j].iter().collect()
                };
                stack.push(looks_like_file(&token).then_some(token));
                i = j;
                continue;
            }
            ')' => {
                stack.pop();
            }
            _ => {}
        }
        i += 1;
    }
}

fn leading_number(text: &str) -> Option<u32> {
    let digits: String = text.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// `path:line: message` (from `-file-line-error`).
fn file_line_error(line: &str) -> Option<(&str, u32, &str)> {
    line.match_indices(':').find_map(|(index, _)| {
        let path = &line[..index];
        let rest = &line[index + 1..];
        let number = leading_number(rest)?;
        let digits = rest.chars().take_while(char::is_ascii_digit).count();
        let message = rest[digits..].strip_prefix(": ")?;
        (looks_like_file(path) && !message.trim().is_empty()).then_some((path, number, message))
    })
}

fn warning_start(line: &str) -> Option<&str> {
    let (head, rest) = line.split_once(" Warning: ")?;
    let known = head == "LaTeX" || head == "LaTeX Font" || head.starts_with("Package ") || head.starts_with("Class ");
    known.then_some(rest)
}

/// `(hyperref)    more text` continues a package warning.
fn continuation(line: &str) -> Option<&str> {
    let rest = line.strip_prefix('(')?;
    let (name, text) = rest.split_once(')')?;
    (!name.is_empty() && !name.contains(char::is_whitespace)).then(|| text.trim())
}

fn one_line(text: &str) -> String {
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out: String = joined.chars().take(MAX_MESSAGE).collect();
    if joined.chars().count() > MAX_MESSAGE {
        out.push('…');
    }
    out
}

fn locate(table: &PathTable, path: Option<&str>, message: &str) -> (Option<String>, String) {
    match path.map(|p| table.map(p)) {
        Some(Mapped::Project(rel)) => (Some(rel), one_line(message)),
        Some(Mapped::External(name)) => (None, one_line(&format!("{name}: {message}"))),
        None => (None, one_line(message)),
    }
}

pub fn parse_problems(log: &str, table: &PathTable) -> Vec<Problem> {
    let lines: Vec<&str> = log.lines().collect();
    let mut stack: Vec<Option<String>> = Vec::new();
    let mut problems = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let top = stack.iter().rev().flatten().next().cloned();
        let mut push = |severity, path: Option<&str>, line: Option<u32>, message: &str| {
            let (file, message) = locate(table, path, message);
            // A line without a project file can't be opened, so drop it.
            let line = if file.is_some() { line } else { None };
            problems.push(Problem { severity, file, line, message });
        };
        let mut next = i + 1;
        if let Some((path, number, message)) = file_line_error(line) {
            push(Severity::Error, Some(path), Some(number), message);
        } else if let Some(message) = line.strip_prefix("! ") {
            let number = lines[i + 1..].iter().take(30).find_map(|l| l.strip_prefix("l.").and_then(leading_number));
            push(Severity::Error, top.as_deref(), number, message);
        } else if let Some(rest) = warning_start(line) {
            let mut text = rest.trim().to_string();
            while next < lines.len() && !text.contains("input line") {
                let Some(more) = continuation(lines[next]) else { break };
                text.push(' ');
                text.push_str(more);
                next += 1;
            }
            if let Some(at) = text.find(" on input line ") {
                let number = leading_number(&text[at + " on input line ".len()..]);
                push(Severity::Warning, top.as_deref(), number, text[..at].trim_end_matches('.'));
            }
        } else if line.starts_with("Overfull \\") || line.starts_with("Underfull \\") {
            if let Some(at) = line.find(" at line") {
                let digits = line[at..].trim_start_matches(" at lines ").trim_start_matches(" at line ");
                let message = line.split(" in paragraph").next().unwrap_or(line).split(" detected").next().unwrap_or(line);
                push(Severity::Warning, top.as_deref(), leading_number(digits), message);
            }
        }
        for skipped in &lines[i..next] {
            track_parens(skipped, &mut stack);
        }
        i = next;
    }
    let mut seen = std::collections::HashSet::new();
    problems.retain(|p| seen.insert((p.file.clone(), p.line, p.message.clone())));
    problems.sort_by_key(|p| p.severity);
    problems.truncate(MAX_PROBLEMS);
    problems
}

// ---------------------------------------------------------------------------
// SyncTeX lookups
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SyncTarget {
    Project { file: String, line: u32 },
    External { name: String },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PdfSpot {
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn field<'a>(stdout: &'a str, key: &str) -> Option<&'a str> {
    stdout.lines().find_map(|line| line.strip_prefix(key)).map(str::trim)
}

fn parse_edit(stdout: &str) -> Option<(String, u32)> {
    let input = field(stdout, "Input:")?.to_string();
    let line = field(stdout, "Line:")?.parse::<i64>().ok().filter(|n| *n > 0)?;
    Some((input, line as u32))
}

fn parse_view(stdout: &str) -> Option<PdfSpot> {
    let num = |key| field(stdout, key).and_then(|v| v.parse::<f64>().ok());
    let page = field(stdout, "Page:")?.parse::<u32>().ok().filter(|p| *p > 0)?;
    let (h, v, w, height) = (num("h:")?, num("v:")?, num("W:").unwrap_or(0.0), num("H:").unwrap_or(0.0));
    Some(PdfSpot { page, x: h, y: (v - height).max(0.0), width: w, height })
}

fn run_synctex(exe: &Path, args: &[String]) -> Result<String, String> {
    let mut command = Command::new(exe);
    command.args(args);
    let output = run_with_timeout(command, LOOKUP_TIMEOUT, &|| false)?;
    Ok(output.stdout)
}

fn shown_for(project: &ProjectState, sync: &SyncState, main: &str) -> Result<Shown, String> {
    let root = project.with(|open| Ok(open.root.clone())).map_err(|error| error.message)?;
    let out_dir = build_dir_for(&root, main)?;
    sync.get(&out_dir).filter(|shown| shown.pdf.is_file()).ok_or_else(|| "Compile first".to_string())
}

fn exe(shown: &Shown) -> Result<PathBuf, String> {
    shown.synctex_exe.clone().ok_or_else(|| "synctex.exe was not found next to MiKTeX".to_string())
}

pub fn to_source(shown: &Shown, page: u32, x: f64, y: f64) -> Result<Option<SyncTarget>, String> {
    if page == 0 || !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 {
        return Err("invalid PDF position".into());
    }
    let pdf = shown.pdf.display().to_string();
    let stdout = run_synctex(&exe(shown)?, &["edit".into(), "-o".into(), format!("{page}:{x:.2}:{y:.2}:{pdf}")])?;
    Ok(parse_edit(&stdout).map(|(input, line)| match shown.table.map(&input) {
        Mapped::Project(file) => SyncTarget::Project { file, line },
        Mapped::External(name) => SyncTarget::External { name },
    }))
}

/// Names TeX may have recorded for a project file, most likely first.
fn input_candidates(table: &PathTable, file: &str) -> Vec<String> {
    let rel = file.replace('/', "\\");
    let mut paths: Vec<PathBuf> = Vec::new();
    if norm(file) == norm(&table.main_rel) {
        paths.push(table.main_snapshot.clone());
    } else {
        paths.push(table.overlay.join(&rel));
        paths.extend(table.roots.iter().map(|root| root.join(&rel)));
    }
    let mut out = Vec::new();
    for path in paths {
        let text = path.display().to_string();
        out.push(text.replace('\\', "/"));
        out.push(text);
    }
    if norm(file) == norm(&table.main_rel) {
        if let Some(name) = table.main_snapshot.file_name() {
            out.push(format!("./{}", name.to_string_lossy()));
        }
    }
    out
}

pub fn to_pdf(shown: &Shown, file: &str, line: u32) -> Result<Option<PdfSpot>, String> {
    if line == 0 {
        return Err("invalid line".into());
    }
    let exe = exe(shown)?;
    let pdf = shown.pdf.display().to_string();
    for input in input_candidates(&shown.table, file) {
        let stdout = run_synctex(&exe, &["view".into(), "-i".into(), format!("{line}:0:{input}"), "-o".into(), pdf.clone()])?;
        if let Some(spot) = parse_view(&stdout) {
            return Ok(Some(spot));
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn sync_to_source(
    project: State<'_, ProjectState>,
    sync: State<'_, SyncState>,
    main: String,
    page: u32,
    x: f64,
    y: f64,
) -> Result<Option<SyncTarget>, String> {
    let shown = shown_for(&project, &sync, &main)?;
    tauri::async_runtime::spawn_blocking(move || to_source(&shown, page, x, y)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn sync_to_pdf(
    project: State<'_, ProjectState>,
    sync: State<'_, SyncState>,
    main: String,
    file: String,
    line: u32,
) -> Result<Option<PdfSpot>, String> {
    let root = project.with(|open| Ok(open.root.clone())).map_err(|error| error.message)?;
    crate::project::resolve_in_project(&root, &file).map_err(|error| error.message)?;
    let shown = shown_for(&project, &sync, &main)?;
    tauri::async_runtime::spawn_blocking(move || to_pdf(&shown, &file, line)).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table() -> PathTable {
        PathTable {
            base: PathBuf::from(r"C:\Users\A\AppData\Local\Lexy\Build\abc"),
            main_snapshot: PathBuf::from(r"C:\Users\A\AppData\Local\Lexy\Build\abc\main.tex"),
            main_rel: "main.tex".into(),
            overlay: PathBuf::from(r"C:\Users\A\AppData\Local\Lexy\Build\abc\.lexy-overlay"),
            roots: vec![PathBuf::from(r"D:\Thesis"), PathBuf::from(r"C:\Users\A\AppData\Local\Lexy\Build\abc\.lexy-root")],
        }
    }

    #[test]
    fn maps_build_paths_back_to_project_files() {
        let t = table();
        let p = |s: &str| Mapped::Project(s.into());
        assert_eq!(t.map("./main.tex"), p("main.tex"));
        assert_eq!(t.map(r"c:/users/a/appdata/local/lexy/build/abc/MAIN.tex"), p("main.tex"));
        assert_eq!(t.map("C:/Users/A/AppData/Local/Lexy/Build/abc/.lexy-overlay/chapters/Intro.tex"), p("chapters/Intro.tex"));
        assert_eq!(t.map(r"D:\Thesis\chapters\two.tex"), p("chapters/two.tex"));
        assert_eq!(t.map("d:/thesis/./figs/../chapters/x.tex"), p("chapters/x.tex"));
        assert_eq!(t.map(r"\\?\D:\Thesis\a.tex"), p("a.tex"));
        assert_eq!(t.map("C:/Users/A/AppData/Local/Lexy/Build/abc/.lexy-root/অধ্যায়/ভূমিকা.tex"), p("অধ্যায়/ভূমিকা.tex"));
        assert_eq!(t.map("C:/Program Files/MiKTeX/tex/latex/base/article.cls"), Mapped::External("article.cls".into()));
        assert_eq!(t.map(r"D:\Other\x.tex"), Mapped::External("x.tex".into()));
    }

    #[test]
    fn parses_errors_and_warnings_with_files_and_lines() {
        let log = "This is pdfTeX\n\
(./main.tex\n\
LaTeX2e <2024>\n\
(C:/Program Files/MiKTeX/tex/latex/base/article.cls\n\
Document Class: article\n\
(C:/Program Files/MiKTeX/tex/latex/base/size10.clo))\n\
(C:/Users/A/AppData/Local/Lexy/Build/abc/.lexy-overlay/chapters/intro.tex\n\
C:/Users/A/AppData/Local/Lexy/Build/abc/.lexy-overlay/chapters/intro.tex:5: Undefined control sequence.\n\
l.5 \\foo\n\
Overfull \\hbox (12.0pt too wide) in paragraph at lines 7--9\n\
[]\\OT1/cmr/m/n/10 text\n\
)\n\
LaTeX Warning: Reference `nope' on page 1 undefined on input line 12.\n\
Package hyperref Warning: Token not allowed in a PDF string (Unicode):\n\
(hyperref)                removing `math shift' on input line 14.\n\
! Missing } inserted.\n\
<inserted text>\n\
l.20 \\end{document}\n\
C:/Program Files/MiKTeX/tex/latex/base/article.cls:3: Oops.\n\
LaTeX Warning: There were undefined references.\n\
)";
        let got = parse_problems(log, &table());
        let view: Vec<_> = got.iter().map(|p| (p.severity, p.file.as_deref(), p.line, p.message.as_str())).collect();
        assert_eq!(
            view,
            [
                (Severity::Error, Some("chapters/intro.tex"), Some(5), "Undefined control sequence."),
                (Severity::Error, Some("main.tex"), Some(20), "Missing } inserted."),
                (Severity::Error, None, None, "article.cls: Oops."),
                (Severity::Warning, Some("chapters/intro.tex"), Some(7), "Overfull \\hbox (12.0pt too wide)"),
                (Severity::Warning, Some("main.tex"), Some(12), "Reference `nope' on page 1 undefined"),
                (
                    Severity::Warning,
                    Some("main.tex"),
                    Some(14),
                    "Token not allowed in a PDF string (Unicode): removing `math shift'"
                ),
            ]
        );
    }

    #[test]
    fn problems_are_capped_and_deduplicated() {
        let mut log = String::from("(./main.tex\n");
        for n in 0..250 {
            log.push_str(&format!("./main.tex:{n}: Bad.\n./main.tex:{n}: Bad.\n"));
        }
        let got = parse_problems(&log, &table());
        assert_eq!(got.len(), MAX_PROBLEMS);
        let long = format!("./main.tex:1: {}\n", "x".repeat(500));
        assert!(parse_problems(&long, &table())[0].message.chars().count() <= MAX_MESSAGE + 1);
    }

    #[test]
    fn parses_synctex_output_and_rejects_bad_input() {
        let edit = "This is SyncTeX command line utility, version 1.5\nSyncTeX result begin\nOutput:x.pdf\nInput:C:/b/.lexy-overlay/a.tex\nLine:12\nColumn:-1\nSyncTeX result end\n";
        assert_eq!(parse_edit(edit), Some(("C:/b/.lexy-overlay/a.tex".into(), 12)));
        assert_eq!(parse_edit("SyncTeX result begin\nSyncTeX result end\n"), None);
        let view = "SyncTeX result begin\nOutput:x.pdf\nPage:2\nx:100.5\ny:200\nh:72.0\nv:210.0\nW:300.0\nH:10.0\nbefore:\nSyncTeX result end\n";
        assert_eq!(parse_view(view), Some(PdfSpot { page: 2, x: 72.0, y: 200.0, width: 300.0, height: 10.0 }));
        let shown = Shown { out_dir: PathBuf::new(), pdf: PathBuf::new(), table: table(), synctex_exe: None };
        assert!(to_source(&shown, 0, 1.0, 1.0).is_err());
        assert!(to_source(&shown, 1, f64::NAN, 1.0).is_err());
        assert!(to_source(&shown, 1, -1.0, 1.0).is_err());
        assert!(to_pdf(&shown, "main.tex", 0).is_err());
        let json = serde_json::to_value(SyncTarget::Project { file: "a.tex".into(), line: 3 }).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "project", "file": "a.tex", "line": 3 }));
        let problem = Problem { severity: Severity::Warning, file: None, line: None, message: "m".into() };
        assert_eq!(serde_json::to_value(problem).unwrap()["severity"], "warning");
    }
}
