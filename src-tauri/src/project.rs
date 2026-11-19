//! Folder projects (specs/004-project-workspace): the open project's root lives in managed
//! state, and every file path from the frontend is project-relative and goes through
//! `resolve_in_project`, so nothing outside the project folder is ever touched.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    ffi::OsStr,
    fs::{self, File},
    io,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{build_key, lexy_folder, write_atomic, MAX_DOCUMENT_BYTES};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    OutsideProject,
    NotFound,
    NameTaken,
    InvalidName,
    NoRecycleBin,
    ReadOnly,
    NoProject,
    Io,
}

/// Errors the UI branches on (contracts/backend-commands.md).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ProjectError {
    pub kind: ErrorKind,
    pub message: String,
}

impl ProjectError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
    fn io(context: &str, error: io::Error) -> Self {
        let kind = if error.kind() == io::ErrorKind::NotFound { ErrorKind::NotFound } else { ErrorKind::Io };
        Self::new(kind, format!("{context}: {error}"))
    }
}

impl From<String> for ProjectError {
    fn from(message: String) -> Self {
        Self::new(ErrorKind::Io, message)
    }
}

type Result<T> = std::result::Result<T, ProjectError>;

// ---------------------------------------------------------------------------
// Names and paths
// ---------------------------------------------------------------------------

const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2",
    "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// A single file or folder name Windows accepts.
pub fn valid_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    !name.is_empty()
        && name.len() <= 255
        && !name.ends_with(['.', ' '])
        && name != "."
        && name != ".."
        && !name.chars().any(|c| "<>:\"/\\|?*".contains(c) || (c as u32) < 32)
        && !RESERVED.contains(&stem.as_str())
}

/// Resolve a project-relative path (either separator) to an absolute path inside `root`.
/// `root` must be canonical. Existing ancestors are canonicalized, so junctions or
/// symlinks that lead out of the project are refused too.
pub fn resolve_in_project(root: &Path, rel: &str) -> Result<PathBuf> {
    let outside = || ProjectError::new(ErrorKind::OutsideProject, format!("{rel} is outside the project"));
    let mut path = root.to_path_buf();
    for part in rel.split(['/', '\\']).filter(|part| !part.is_empty()) {
        if !valid_name(part) {
            return Err(if part == ".." || part.contains(':') { outside() } else {
                ProjectError::new(ErrorKind::InvalidName, format!("\"{part}\" is not a valid name"))
            });
        }
        path.push(part);
    }
    if rel.starts_with(['/', '\\']) {
        return Err(outside());
    }
    // Canonicalize the nearest existing ancestor and check it is still under root.
    let mut existing = path.as_path();
    while !existing.exists() {
        existing = existing.parent().ok_or_else(outside)?;
    }
    let canonical = fs::canonicalize(existing).map_err(|error| ProjectError::io("failed to resolve path", error))?;
    if !canonical.starts_with(root) {
        return Err(outside());
    }
    Ok(path)
}

/// `root`-relative display path with `\` separators.
fn relative(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let parts: Vec<&str> = rel.components().filter_map(|c| match c {
        Component::Normal(part) => part.to_str(),
        _ => None,
    }).collect();
    Some(parts.join("\\"))
}

const EDITABLE: [&str; 7] = ["tex", "bib", "cls", "sty", "txt", "bst", "md"];
const CLUTTER: [&str; 13] = [
    "aux", "log", "fls", "fdb_latexmk", "synctex.gz", "out", "toc", "bbl", "blg", "bcf", "run.xml", "lof", "lot",
];

fn extension(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    for compound in ["synctex.gz", "run.xml"] {
        if lower.ends_with(&format!(".{compound}")) {
            return compound.to_string();
        }
    }
    lower.rsplit_once('.').map(|(_, ext)| ext.to_string()).unwrap_or_default()
}

/// (editable, hidden) for a file or folder name (data-model.md Entry).
pub fn classify(name: &str, is_dir: bool) -> (bool, bool) {
    let ext = extension(name);
    let hidden = name.starts_with('.') || (!is_dir && CLUTTER.contains(&ext.as_str()));
    (!is_dir && EDITABLE.contains(&ext.as_str()), hidden)
}

fn is_editable(path: &Path) -> bool {
    path.file_name().and_then(OsStr::to_str).is_some_and(|name| classify(name, false).0) || is_notes_file(path)
}

/// `.lexy\notes.json`: the one Lexy file kept inside a project (spec 007 US4, notes travel with it).
fn is_notes_file(path: &Path) -> bool {
    path.file_name().and_then(OsStr::to_str).is_some_and(|name| name.eq_ignore_ascii_case("notes.json"))
        && path.parent().and_then(Path::file_name).and_then(OsStr::to_str).is_some_and(|dir| dir.eq_ignore_ascii_case(".lexy"))
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub kind: &'static str,
    pub editable: bool,
    pub hidden: bool,
    pub modified: u64,
}

pub fn list_dir_at(root: &Path, rel: &str) -> Result<Vec<Entry>> {
    let dir = resolve_in_project(root, rel)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|error| ProjectError::io("failed to list folder", error))?.flatten() {
        let Ok(metadata) = entry.metadata() else { continue };
        let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
        if name.ends_with(".lexy-tmp") {
            continue;
        }
        let is_dir = metadata.is_dir();
        let (editable, hidden) = classify(&name, is_dir);
        entries.push(Entry {
            path: relative(root, &entry.path()).unwrap_or_else(|| name.clone()),
            name,
            kind: if is_dir { "folder" } else { "file" },
            editable,
            hidden,
            modified: modified_ms(&metadata),
        });
    }
    entries.sort_by(|a, b| (a.kind != "folder").cmp(&(b.kind != "folder")).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

/// Entries below `path`, stopping once `limit` is reached; hidden names are skipped (research R11).
pub fn count_entries_at(path: &Path, limit: u64) -> u64 {
    let mut count = 0;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let is_dir = entry.file_type().is_ok_and(|kind| kind.is_dir());
            if classify(name, is_dir).1 {
                continue;
            }
            count += 1;
            if count >= limit {
                return count;
            }
            if is_dir {
                stack.push(entry.path());
            }
        }
    }
    count
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

pub fn read_file_at(root: &Path, rel: &str) -> Result<String> {
    let path = resolve_in_project(root, rel)?;
    if !is_editable(&path) {
        return Err(ProjectError::new(ErrorKind::InvalidName, format!("{rel} can't be edited in Lexy")));
    }
    let metadata = fs::metadata(&path).map_err(|error| ProjectError::io(&format!("failed to open {rel}"), error))?;
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(ProjectError::new(ErrorKind::Io, format!("{rel} is larger than 10 MiB")));
    }
    // Refuse non-UTF-8 rather than silently mangling it on the next save.
    fs::read_to_string(&path).map_err(|error| ProjectError::io(&format!("failed to read {rel}"), error))
}

pub fn write_file_at(root: &Path, rel: &str, contents: &str) -> Result<PathBuf> {
    let path = resolve_in_project(root, rel)?;
    if !is_editable(&path) {
        return Err(ProjectError::new(ErrorKind::InvalidName, format!("{rel} can't be edited in Lexy")));
    }
    if let Some(parent) = path.parent() {
        if !parent.is_dir() {
            return Err(ProjectError::new(ErrorKind::NotFound, format!("the folder for {rel} does not exist")));
        }
    }
    write_atomic(&path, contents.as_bytes())?;
    Ok(path)
}

/// Text files the TypeScript index reads (spec 007 R1); larger files are skipped.
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TEXT_FILES: usize = 2000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectText {
    pub path: String,
    pub text: String,
    pub modified: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTexts {
    pub files: Vec<ProjectText>,
    pub truncated: bool,
}

fn read_text(root: &Path, path: &Path) -> Option<ProjectText> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_TEXT_BYTES || !is_editable(path) {
        return None;
    }
    Some(ProjectText { path: relative(root, path)?, text: fs::read_to_string(path).ok()?, modified: modified_ms(&metadata) })
}

/// Every editable text file below `root` (hidden names and build clutter skipped), or only `paths`.
pub fn project_texts_at(root: &Path, paths: Option<&[String]>) -> Result<ProjectTexts> {
    if let Some(paths) = paths {
        let mut files = Vec::new();
        for rel in paths {
            // Missing or invalid paths are simply omitted: the caller drops them from its cache.
            if let Some(text) = resolve_in_project(root, rel).ok().and_then(|path| read_text(root, &path)) {
                files.push(text);
            }
        }
        return Ok(ProjectTexts { files, truncated: false });
    }
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
            let Ok(kind) = entry.file_type() else { continue };
            // Symlinks and junctions are not followed, so the walk never leaves the project.
            if kind.is_symlink() || classify(&name, kind.is_dir()).1 {
                continue;
            }
            if kind.is_dir() {
                stack.push(entry.path());
            } else if let Some(text) = read_text(root, &entry.path()) {
                if files.len() == MAX_TEXT_FILES {
                    return Ok(ProjectTexts { files, truncated: true });
                }
                files.push(text);
            }
        }
    }
    files.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(ProjectTexts { files, truncated: false })
}

fn taken(rel: &str) -> ProjectError {
    ProjectError::new(ErrorKind::NameTaken, format!("{rel} already exists"))
}

pub fn create_file_at(root: &Path, rel: &str) -> Result<()> {
    let path = resolve_in_project(root, rel)?;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map(drop)
        .map_err(|error| if error.kind() == io::ErrorKind::AlreadyExists { taken(rel) } else { ProjectError::io("failed to create file", error) })
}

pub fn create_folder_at(root: &Path, rel: &str) -> Result<()> {
    let path = resolve_in_project(root, rel)?;
    fs::create_dir(&path)
        .map_err(|error| if error.kind() == io::ErrorKind::AlreadyExists { taken(rel) } else { ProjectError::io("failed to create folder", error) })
}

pub fn rename_entry_at(root: &Path, from: &str, to: &str) -> Result<()> {
    let source = resolve_in_project(root, from)?;
    let target = resolve_in_project(root, to)?;
    if source == root || target == root {
        return Err(ProjectError::new(ErrorKind::OutsideProject, "the project folder itself can't be renamed here"));
    }
    if !source.exists() {
        return Err(ProjectError::new(ErrorKind::NotFound, format!("{from} does not exist")));
    }
    // A case-only rename (intro.tex → Intro.tex) points at the same file on Windows.
    let same = fs::canonicalize(&target).ok() == fs::canonicalize(&source).ok();
    if target.exists() && !same {
        return Err(taken(to));
    }
    if target.starts_with(&source) && !same {
        return Err(ProjectError::new(ErrorKind::InvalidName, "a folder can't be moved into itself"));
    }
    fs::rename(&source, &target).map_err(|error| ProjectError::io("failed to rename", error))
}

/// `name (copy).ext`, then `name (copy 2).ext`… — the first name not taken in `dir`.
fn copy_name(dir: &Path, name: &str, is_dir: bool) -> String {
    let (stem, ext) = match name.rfind('.') {
        Some(dot) if !is_dir && dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name, ""),
    };
    (1..)
        .map(|n| if n == 1 { format!("{stem} (copy){ext}") } else { format!("{stem} (copy {n}){ext}") })
        .find(|candidate| !dir.join(candidate).exists())
        .unwrap_or_else(|| format!("{stem} (copy){ext}"))
}

/// Copy a folder's contents into the existing folder `target`; symlinks and junctions are skipped,
/// so nothing outside the project is pulled in.
fn copy_tree(source: &Path, target: &Path) -> io::Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            continue;
        }
        let to = target.join(entry.file_name());
        if kind.is_dir() {
            fs::create_dir(&to)?;
            copy_tree(&entry.path(), &to)?;
        } else {
            fs::copy(entry.path(), to)?;
        }
    }
    Ok(())
}

/// Copy a file or folder into `to_dir` under a free "(copy)" name; never overwrites. Returns the new path.
pub fn copy_entry_at(root: &Path, from: &str, to_dir: &str) -> Result<String> {
    let source = resolve_in_project(root, from)?;
    let dir = resolve_in_project(root, to_dir)?;
    if source == root {
        return Err(ProjectError::new(ErrorKind::InvalidName, "the project folder itself can't be copied"));
    }
    let metadata = fs::symlink_metadata(&source).map_err(|error| ProjectError::io(&format!("failed to copy {from}"), error))?;
    if metadata.file_type().is_symlink() {
        return Err(ProjectError::new(ErrorKind::InvalidName, format!("{from} is a link and can't be copied")));
    }
    if !dir.is_dir() {
        return Err(ProjectError::new(ErrorKind::NotFound, format!("{to_dir} is not a folder")));
    }
    if metadata.is_dir() && fs::canonicalize(&dir).ok().zip(fs::canonicalize(&source).ok()).is_some_and(|(d, s)| d.starts_with(s)) {
        return Err(ProjectError::new(ErrorKind::InvalidName, "a folder can't be copied into itself"));
    }
    let name = source.file_name().and_then(OsStr::to_str).ok_or_else(|| ProjectError::new(ErrorKind::InvalidName, format!("{from} has no name")))?;
    // A copy into another folder keeps the name when it is free.
    let target_name = if dir.join(name).exists() { copy_name(&dir, name, metadata.is_dir()) } else { name.to_string() };
    let target = dir.join(&target_name);
    let failed = |error| ProjectError::io(&format!("failed to copy {from}"), error);
    if metadata.is_dir() {
        // create_dir fails if the name was taken meanwhile, so the cleanup below only ever removes our own copy.
        fs::create_dir(&target).map_err(failed)?;
        if let Err(error) = copy_tree(&source, &target) {
            let _ = fs::remove_dir_all(&target);
            return Err(failed(error));
        }
    } else {
        fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(failed)?;
        if let Err(error) = fs::copy(&source, &target) {
            let _ = fs::remove_file(&target);
            return Err(failed(error));
        }
    }
    relative(root, &target).ok_or_else(|| ProjectError::new(ErrorKind::Io, "failed to name the copy"))
}

pub fn delete_entry_at(root: &Path, rel: &str, permanent: bool) -> Result<()> {
    let path = resolve_in_project(root, rel)?;
    if path == root || rel.trim_matches(['/', '\\']).is_empty() {
        return Err(ProjectError::new(ErrorKind::OutsideProject, "the project folder itself can't be deleted here"));
    }
    if !path.exists() {
        return Err(ProjectError::new(ErrorKind::NotFound, format!("{rel} does not exist")));
    }
    if permanent {
        let result = if path.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
        return result.map_err(|error| ProjectError::io("failed to delete", error));
    }
    // shortcut: any Recycle Bin failure is reported as "no Recycle Bin" so the UI can offer a
    // permanent delete; distinguish real causes if users hit other failures.
    trash::delete(&path).map_err(|error| ProjectError::new(ErrorKind::NoRecycleBin, error.to_string()))
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub copied: Vec<String>,
    pub skipped: Vec<String>,
    pub conflicts: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OnConflict {
    Replace,
    KeepBoth,
    Skip,
    Ask,
}

/// `name (2).ext`, `name (3).ext`… that does not exist yet in `dir`.
fn free_name(dir: &Path, name: &str) -> PathBuf {
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (name, String::new()),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|candidate| !candidate.exists())
        .unwrap_or_else(|| dir.join(name))
}

fn copy_recursive(source: &Path, target: &Path) -> io::Result<()> {
    if source.is_dir() {
        fs::create_dir_all(target)?;
        for entry in fs::read_dir(source)?.flatten() {
            copy_recursive(&entry.path(), &target.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(source, target).map(drop)
    }
}

/// Copy files dropped from Explorer into `target_dir` (research R5). Sources come from the OS
/// drop; only the target is confined to the project.
pub fn import_files_at(root: &Path, sources: &[String], target_dir: &str, on_conflict: OnConflict) -> Result<ImportResult> {
    let dir = resolve_in_project(root, target_dir)?;
    if !dir.is_dir() {
        return Err(ProjectError::new(ErrorKind::NotFound, format!("{target_dir} is not a folder")));
    }
    let mut result = ImportResult::default();
    for source in sources {
        let source_path = PathBuf::from(source);
        let Some(name) = source_path.file_name().and_then(OsStr::to_str).map(str::to_string) else { continue };
        if !source_path.exists() {
            result.skipped.push(source.clone());
            continue;
        }
        // Dropping a file onto the folder it already lives in is a no-op.
        if fs::canonicalize(&source_path).ok().and_then(|p| p.parent().map(Path::to_path_buf)) == fs::canonicalize(&dir).ok() {
            result.skipped.push(source.clone());
            continue;
        }
        let mut target = dir.join(&name);
        if target.exists() {
            match on_conflict {
                OnConflict::Ask => {
                    result.conflicts.push(source.clone());
                    continue;
                }
                OnConflict::Skip => {
                    result.skipped.push(source.clone());
                    continue;
                }
                OnConflict::KeepBoth => target = free_name(&dir, &name),
                OnConflict::Replace => {
                    let removed = if target.is_dir() { fs::remove_dir_all(&target) } else { fs::remove_file(&target) };
                    removed.map_err(|error| ProjectError::io("failed to replace", error))?;
                }
            }
        }
        copy_recursive(&source_path, &target).map_err(|error| ProjectError::io(&format!("failed to copy {name}"), error))?;
        result.copied.push(relative(root, &target).unwrap_or(name));
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// Main document
// ---------------------------------------------------------------------------

/// Does this text declare a document class before `\begin{document}` (ignoring comments)?
pub fn declares_document(text: &str) -> bool {
    for line in text.lines() {
        let code = line.trim_start();
        if code.starts_with('%') {
            continue;
        }
        let code = code.split('%').next().unwrap_or("");
        if code.contains("\\documentclass") {
            return true;
        }
        if code.contains("\\begin{document}") {
            return false;
        }
    }
    false
}

/// Top-level `.tex` files that look like main documents; exactly one makes it main (research R10).
pub fn detect_main(root: &Path) -> (Option<String>, Vec<String>) {
    let mut candidates = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(OsStr::to_str) else { continue };
            if !path.is_file() || extension(name) != "tex" || name.starts_with('.') {
                continue;
            }
            let mut head = Vec::new();
            if let Ok(file) = File::open(&path) {
                use std::io::Read;
                let _ = file.take(64 * 1024).read_to_end(&mut head);
            }
            if declares_document(&String::from_utf8_lossy(&head)) {
                candidates.push(name.to_string());
            }
        }
    }
    candidates.sort_by_key(|name| name.to_lowercase());
    let main = (candidates.len() == 1).then(|| candidates[0].clone());
    (main, candidates)
}

// ---------------------------------------------------------------------------
// Recent projects store (%LOCALAPPDATA%\Lexy\projects.json)
// ---------------------------------------------------------------------------

const STORE_VERSION: u32 = 1;
const MAX_RECENT: usize = 20;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub path: String,
    pub main_document: Option<String>,
    pub last_opened: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub version: u32,
    pub last_open: Option<String>,
    pub projects: Vec<RecentEntry>,
}

impl Default for Store {
    fn default() -> Self {
        Self { version: STORE_VERSION, last_open: None, projects: Vec::new() }
    }
}

fn same_path(a: &str, b: &str) -> bool {
    a.trim_end_matches(['\\', '/']).eq_ignore_ascii_case(b.trim_end_matches(['\\', '/']))
}

impl Store {
    pub fn entry(&self, path: &str) -> Option<&RecentEntry> {
        self.projects.iter().find(|entry| same_path(&entry.path, path))
    }

    /// Move `path` to the front with `last_opened = now`, keeping its main document.
    pub fn touch(&mut self, path: &str, now: u64) {
        let main = self.entry(path).and_then(|entry| entry.main_document.clone());
        self.projects.retain(|entry| !same_path(&entry.path, path));
        self.projects.insert(0, RecentEntry { path: path.to_string(), main_document: main, last_opened: now });
        self.projects.truncate(MAX_RECENT);
    }

    pub fn set_main(&mut self, path: &str, main: &str) {
        if self.entry(path).is_none() {
            self.touch(path, now_ms());
        }
        if let Some(entry) = self.projects.iter_mut().find(|entry| same_path(&entry.path, path)) {
            entry.main_document = Some(main.to_string());
        }
    }

    pub fn forget(&mut self, path: &str) {
        self.projects.retain(|entry| !same_path(&entry.path, path));
        if self.last_open.as_deref().is_some_and(|last| same_path(last, path)) {
            self.last_open = None;
        }
    }
}

pub fn load_store(dir: &Path) -> Store {
    let file = dir.join("projects.json");
    let Ok(text) = fs::read_to_string(&file) else { return Store::default() };
    match serde_json::from_str::<Store>(&text) {
        Ok(store) if store.version == STORE_VERSION => store,
        _ => {
            let _ = fs::rename(&file, dir.join("projects.json.bak"));
            Store::default()
        }
    }
}

pub fn save_store(dir: &Path, store: &Store) -> Result<()> {
    fs::create_dir_all(dir).map_err(|error| ProjectError::io("failed to create app data folder", error))?;
    let json = serde_json::to_string_pretty(store).map_err(|error| ProjectError::new(ErrorKind::Io, error.to_string()))?;
    write_atomic(&dir.join("projects.json"), json.as_bytes())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Project Home
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub path: String,
    pub name: String,
    pub modified: u64,
    pub last_opened: Option<u64>,
    pub in_default_folder: bool,
    pub missing: bool,
}

/// Newest change among the folder and its top-level entries.
fn folder_modified(path: &Path) -> u64 {
    let own = fs::metadata(path).map(|m| modified_ms(&m)).unwrap_or(0);
    fs::read_dir(path)
        .map(|entries| entries.flatten().filter_map(|e| e.metadata().ok()).map(|m| modified_ms(&m)).max().unwrap_or(0))
        .unwrap_or(0)
        .max(own)
}

pub fn list_projects_at(default_folder: &Path, store: &Store) -> Vec<ProjectSummary> {
    let mut projects: Vec<ProjectSummary> = Vec::new();
    if let Ok(entries) = fs::read_dir(default_folder) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(OsStr::to_str).map(str::to_string) else { continue };
            if !path.is_dir() || name.starts_with('.') {
                continue;
            }
            let shown = path.display().to_string();
            projects.push(ProjectSummary {
                last_opened: store.entry(&shown).map(|e| e.last_opened),
                modified: folder_modified(&path),
                path: shown,
                name,
                in_default_folder: true,
                missing: false,
            });
        }
    }
    for entry in &store.projects {
        if projects.iter().any(|p| same_path(&p.path, &entry.path)) {
            continue;
        }
        let path = Path::new(&entry.path);
        let inside = path.parent().is_some_and(|parent| same_path(&parent.display().to_string(), &default_folder.display().to_string()));
        projects.push(ProjectSummary {
            name: path.file_name().and_then(OsStr::to_str).unwrap_or(&entry.path).to_string(),
            modified: folder_modified(path),
            last_opened: Some(entry.last_opened),
            in_default_folder: inside,
            missing: !path.is_dir(),
            path: entry.path.clone(),
        });
    }
    projects.sort_by(|a, b| b.last_opened.unwrap_or(0).cmp(&a.last_opened.unwrap_or(0)).then(b.modified.cmp(&a.modified)));
    projects
}

/// `<default>\<name>\<name>.tex` with the starter text; `<name> (2)` when taken.
pub fn create_project_at(default_folder: &Path, name: &str, starter: &str) -> Result<PathBuf> {
    let name = name.trim();
    if !valid_name(name) {
        return Err(ProjectError::new(ErrorKind::InvalidName, "Use a name without \\ / : * ? \" < > |"));
    }
    let folder = (1..1000)
        .map(|n| if n == 1 { name.to_string() } else { format!("{name} ({n})") })
        .map(|candidate| default_folder.join(candidate))
        .find(|candidate| !candidate.exists())
        .ok_or_else(|| ProjectError::new(ErrorKind::NameTaken, format!("{name} already exists")))?;
    fs::create_dir_all(&folder).map_err(|error| ProjectError::io("failed to create project folder", error))?;
    let stem = folder.file_name().and_then(OsStr::to_str).unwrap_or(name).to_string();
    write_atomic(&folder.join(format!("{stem}.tex")), starter.as_bytes())?;
    Ok(folder)
}

// ---------------------------------------------------------------------------
// Open project state, lock and watcher
// ---------------------------------------------------------------------------

/// Paths Lexy itself just wrote, with the mtime it left, so the watcher can ignore them.
pub type RecentWrites = Arc<Mutex<HashMap<PathBuf, SystemTime>>>;

pub struct OpenProject {
    pub root: PathBuf,
    pub main: Option<String>,
    pub read_only: bool,
    _lock: Option<File>,
    _watcher: Option<Box<dyn std::any::Any + Send>>,
    pub writes: RecentWrites,
}

#[derive(Default)]
pub struct ProjectState(pub Mutex<Option<OpenProject>>);

impl ProjectState {
    pub fn with<T>(&self, run: impl FnOnce(&mut OpenProject) -> Result<T>) -> Result<T> {
        let mut guard = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let project = guard.as_mut().ok_or_else(|| ProjectError::new(ErrorKind::NoProject, "no project is open"))?;
        run(project)
    }

    fn writable<T>(&self, run: impl FnOnce(&mut OpenProject) -> Result<T>) -> Result<T> {
        self.with(|project| {
            if project.read_only {
                return Err(ProjectError::new(ErrorKind::ReadOnly, "this project is open in another Lexy window"));
            }
            run(project)
        })
    }
}

/// Exclusive lock per project root; `None` when another process holds it (research R9).
/// The OS releases it when the process exits, even after a crash.
pub fn acquire_lock(locks_dir: &Path, root: &Path) -> Result<Option<File>> {
    fs::create_dir_all(locks_dir).map_err(|error| ProjectError::io("failed to create lock folder", error))?;
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(locks_dir.join(format!("{}.lock", build_key(root))))
        .map_err(|error| ProjectError::io("failed to open lock file", error))?;
    match file.try_lock() {
        Ok(()) => Ok(Some(file)),
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(std::fs::TryLockError::Error(error)) => Err(ProjectError::io("failed to lock project", error)),
    }
}

/// Should a watcher event for `path` reach the UI?
fn watcher_relevant(root: &Path, path: &Path, writes: &RecentWrites) -> Option<String> {
    let rel = relative(root, path)?;
    // Hidden folders (.git) and Lexy's own `.name.lexy-tmp` save files.
    if rel.is_empty() || rel.split('\\').any(|part| part.starts_with('.')) {
        return None;
    }
    let name = rel.rsplit('\\').next().unwrap_or(&rel);
    if classify(name, path.is_dir()).1 {
        return None;
    }
    let ours = writes
        .lock()
        .ok()
        .and_then(|writes| writes.get(path).copied())
        .is_some_and(|written| fs::metadata(path).and_then(|m| m.modified()).ok() == Some(written));
    (!ours).then_some(rel)
}

#[derive(Clone, Serialize)]
struct ChangedPayload {
    paths: Vec<String>,
}

fn start_watcher(app: &AppHandle, root: &Path, writes: RecentWrites) -> Option<Box<dyn std::any::Any + Send>> {
    use notify_debouncer_full::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
    let app = app.clone();
    let watched = root.to_path_buf();
    let mut debouncer = new_debouncer(Duration::from_millis(500), None, move |result: DebounceEventResult| {
        if !watched.is_dir() {
            let _ = app.emit("project-missing", ());
            return;
        }
        match result {
            Ok(events) => {
                let mut paths: Vec<String> = events
                    .iter()
                    .flat_map(|event| event.paths.iter())
                    .filter_map(|path| watcher_relevant(&watched, path, &writes))
                    .collect();
                paths.sort();
                paths.dedup();
                if !paths.is_empty() {
                    let _ = app.emit("project-changed", ChangedPayload { paths });
                }
            }
            Err(_) => {
                if !watched.is_dir() {
                    let _ = app.emit("project-missing", ());
                }
            }
        }
    })
    .ok()?;
    debouncer.watch(root, RecursiveMode::Recursive).ok()?;
    Some(Box::new(debouncer))
}

pub(crate) fn app_data_dir() -> Result<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(|base| PathBuf::from(base).join("Lexy"))
        .ok_or_else(|| ProjectError::new(ErrorKind::Io, "LOCALAPPDATA is not set"))
}

fn default_folder(app: &AppHandle) -> Result<PathBuf> {
    let folder = lexy_folder(app.path().document_dir(), app.path().home_dir().ok())?;
    Ok(PathBuf::from(folder.path))
}

/// Windows canonical paths carry `\\?\`; strip it for display and storage.
pub fn display_path(path: &Path) -> String {
    let text = path.display().to_string();
    text.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(text)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn blocking<T: Send + 'static>(run: impl FnOnce() -> Result<T> + Send + 'static) -> impl std::future::Future<Output = Result<T>> {
    async move {
        tauri::async_runtime::spawn_blocking(run)
            .await
            .map_err(|error| ProjectError::new(ErrorKind::Io, format!("task failed: {error}")))?
    }
}

#[tauri::command]
pub async fn list_projects(app: AppHandle) -> Result<Vec<ProjectSummary>> {
    let folder = default_folder(&app)?;
    blocking(move || Ok(list_projects_at(&folder, &load_store(&app_data_dir()?)))).await
}

#[tauri::command]
pub fn last_open_project() -> Result<Option<String>> {
    let store = load_store(&app_data_dir()?);
    Ok(store.last_open.filter(|path| Path::new(path).is_dir()))
}

#[tauri::command]
pub async fn create_project(app: AppHandle, name: String, starter: String) -> Result<String> {
    let folder = default_folder(&app)?;
    blocking(move || create_project_at(&folder, &name, &starter).map(|path| display_path(&path))).await
}

#[tauri::command]
pub async fn count_entries(path: String, limit: u64) -> Result<u64> {
    blocking(move || Ok(count_entries_at(Path::new(&path), limit))).await
}

#[tauri::command]
pub fn forget_project(path: String) -> Result<()> {
    let dir = app_data_dir()?;
    let mut store = load_store(&dir);
    store.forget(&path);
    save_store(&dir, &store)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProject {
    pub root: String,
    pub name: String,
    pub read_only: bool,
    pub main_document: Option<String>,
    pub candidates: Vec<String>,
}

#[tauri::command]
pub fn open_project(app: AppHandle, state: State<'_, ProjectState>, path: String) -> Result<OpenedProject> {
    // Drop the previous project's lock and watcher first.
    *state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    let canonical = fs::canonicalize(&path).map_err(|error| ProjectError::io(&format!("failed to open {path}"), error))?;
    if !canonical.is_dir() {
        return Err(ProjectError::new(ErrorKind::NotFound, format!("{path} is not a folder")));
    }
    let shown = display_path(&canonical);
    let dir = app_data_dir()?;
    let lock = acquire_lock(&dir.join("Locks"), &canonical)?;
    let read_only = lock.is_none();

    let mut store = load_store(&dir);
    let (detected, candidates) = detect_main(&canonical);
    let remembered = store
        .entry(&shown)
        .and_then(|entry| entry.main_document.clone())
        .filter(|main| canonical.join(main).is_file());
    let main = detected.or(remembered);
    store.touch(&shown, now_ms());
    store.last_open = Some(shown.clone());
    if let Some(main) = &main {
        store.set_main(&shown, main);
    }
    save_store(&dir, &store)?;

    // Old snapshots go when their project is opened (spec 007 US5).
    let snapshot_dir = crate::snapshots::project_dir(&dir, &canonical);
    std::thread::spawn(move || crate::snapshots::prune(&snapshot_dir, now_ms()));

    let writes: RecentWrites = Arc::default();
    let watcher = start_watcher(&app, &canonical, Arc::clone(&writes));
    let name = canonical.file_name().and_then(OsStr::to_str).unwrap_or(&shown).to_string();
    *state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(OpenProject {
        root: canonical,
        main: main.clone(),
        read_only,
        _lock: lock,
        _watcher: watcher,
        writes,
    });
    Ok(OpenedProject { root: shown, name, read_only, main_document: main, candidates })
}

/// Back to Project Home: drop lock and watcher, and don't reopen this project on next start.
#[tauri::command]
pub fn close_project(state: State<'_, ProjectState>) -> Result<()> {
    *state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    let dir = app_data_dir()?;
    let mut store = load_store(&dir);
    store.last_open = None;
    save_store(&dir, &store)
}

#[tauri::command]
pub fn set_main_document(state: State<'_, ProjectState>, rel: String) -> Result<()> {
    let root = state.with(|project| {
        let path = resolve_in_project(&project.root, &rel)?;
        if !path.is_file() || extension(&rel) != "tex" {
            return Err(ProjectError::new(ErrorKind::InvalidName, format!("{rel} is not a .tex file")));
        }
        project.main = Some(rel.clone());
        Ok(project.root.clone())
    })?;
    let dir = app_data_dir()?;
    let mut store = load_store(&dir);
    store.set_main(&display_path(&root), &rel);
    save_store(&dir, &store)
}

#[tauri::command]
pub fn list_dir(state: State<'_, ProjectState>, rel: String) -> Result<Vec<Entry>> {
    state.with(|project| list_dir_at(&project.root, &rel))
}

#[tauri::command]
pub fn read_file(state: State<'_, ProjectState>, rel: String) -> Result<String> {
    state.with(|project| read_file_at(&project.root, &rel))
}

/// Before a save in a project without Git, keep the text being replaced (spec 007 US5).
/// Best effort: a failed snapshot never blocks the save.
fn keep_snapshot(root: &Path, rel: &str, contents: &str) {
    if crate::snapshots::has_git(root) {
        return;
    }
    let Ok(path) = resolve_in_project(root, rel) else { return };
    let Ok(previous) = fs::read_to_string(&path) else { return };
    if previous == contents {
        return;
    }
    if let Ok(base) = app_data_dir() {
        let _ = crate::snapshots::take(&crate::snapshots::project_dir(&base, root), rel, &previous, now_ms());
    }
}

#[tauri::command]
pub fn list_snapshots(state: State<'_, ProjectState>, file: String) -> Result<Vec<crate::snapshots::Snapshot>> {
    let root = state.with(|project| Ok(project.root.clone()))?;
    resolve_in_project(&root, &file)?;
    Ok(crate::snapshots::list(&crate::snapshots::project_dir(&app_data_dir()?, &root), &file))
}

#[tauri::command]
pub fn read_snapshot(state: State<'_, ProjectState>, file: String, time: u64) -> Result<String> {
    let root = state.with(|project| Ok(project.root.clone()))?;
    resolve_in_project(&root, &file)?;
    crate::snapshots::read(&crate::snapshots::project_dir(&app_data_dir()?, &root), &file, time)
        .map_err(|error| ProjectError::io("failed to read the snapshot", error))
}

#[tauri::command]
pub async fn copy_entry(state: State<'_, ProjectState>, from: String, to_dir: String) -> Result<String> {
    let root = state.writable(|project| Ok(project.root.clone()))?;
    blocking(move || copy_entry_at(&root, &from, &to_dir)).await
}

#[tauri::command]
pub async fn project_texts(state: State<'_, ProjectState>, paths: Option<Vec<String>>) -> Result<ProjectTexts> {
    let root = state.with(|project| Ok(project.root.clone()))?;
    blocking(move || project_texts_at(&root, paths.as_deref())).await
}

#[tauri::command]
pub fn write_file(state: State<'_, ProjectState>, rel: String, contents: String) -> Result<()> {
    state.writable(|project| {
        keep_snapshot(&project.root, &rel, &contents);
        let path = write_file_at(&project.root, &rel, &contents)?;
        if let (Ok(modified), Ok(mut writes)) = (fs::metadata(&path).and_then(|m| m.modified()), project.writes.lock()) {
            writes.insert(path, modified);
        }
        Ok(())
    })
}

#[tauri::command]
pub fn create_file(state: State<'_, ProjectState>, rel: String) -> Result<()> {
    state.writable(|project| create_file_at(&project.root, &rel))
}

#[tauri::command]
pub fn create_folder(state: State<'_, ProjectState>, rel: String) -> Result<()> {
    state.writable(|project| create_folder_at(&project.root, &rel))
}

#[tauri::command]
pub fn rename_entry(state: State<'_, ProjectState>, from: String, to: String) -> Result<()> {
    state.writable(|project| {
        rename_entry_at(&project.root, &from, &to)?;
        // Keep the main document pointing at the same file.
        if let Some(main) = &project.main {
            let (main_l, from_l) = (main.to_lowercase(), from.to_lowercase().replace('/', "\\"));
            if main_l == from_l || main_l.starts_with(&format!("{from_l}\\")) {
                project.main = Some(format!("{}{}", to.replace('/', "\\"), &main[from_l.len()..]));
            }
        }
        Ok(())
    })
}

#[tauri::command]
pub fn delete_entry(state: State<'_, ProjectState>, rel: String, permanent: bool) -> Result<()> {
    state.writable(|project| delete_entry_at(&project.root, &rel, permanent))
}

#[tauri::command]
pub fn import_files(state: State<'_, ProjectState>, sources: Vec<String>, target_dir: String, on_conflict: OnConflict) -> Result<ImportResult> {
    state.writable(|project| import_files_at(&project.root, &sources, &target_dir, on_conflict))
}

#[tauri::command]
pub fn open_entry_external(app: AppHandle, state: State<'_, ProjectState>, rel: String) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let path = state.with(|project| resolve_in_project(&project.root, &rel))?;
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|error| ProjectError::new(ErrorKind::Io, error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = env::temp_dir().join(format!("lexy-project-test-{}-{label}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("create temp dir");
            Self(fs::canonicalize(&dir).expect("canonical temp dir"))
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn kind<T: std::fmt::Debug>(result: Result<T>) -> ErrorKind {
        result.expect_err("expected an error").kind
    }

    // ----- names and paths -----

    #[test]
    fn valid_name_rejects_windows_forbidden_names() {
        for ok in ["intro.tex", "Chapter 1", "fig (2).png", ".hidden", "a.b.c"] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in ["", ".", "..", "a:b", "a*b", "name.", "name ", "CON", "con.txt", "LPT1", "a\tb", "x/y"] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn resolve_in_project_accepts_relative_paths_with_either_separator() {
        let root = TempDir::new("resolve-ok");
        assert_eq!(resolve_in_project(&root.0, "chapters/intro.tex").unwrap(), root.0.join("chapters").join("intro.tex"));
        assert_eq!(resolve_in_project(&root.0, "chapters\\intro.tex").unwrap(), root.0.join("chapters").join("intro.tex"));
        assert_eq!(resolve_in_project(&root.0, "").unwrap(), root.0);
    }

    #[test]
    fn resolve_in_project_rejects_escapes_and_bad_names() {
        let root = TempDir::new("resolve-bad");
        assert_eq!(kind(resolve_in_project(&root.0, "..\\x")), ErrorKind::OutsideProject);
        assert_eq!(kind(resolve_in_project(&root.0, "a\\..\\..\\x")), ErrorKind::OutsideProject);
        assert_eq!(kind(resolve_in_project(&root.0, "C:\\x")), ErrorKind::OutsideProject);
        assert_eq!(kind(resolve_in_project(&root.0, "\\\\server\\x")), ErrorKind::OutsideProject);
        assert_eq!(kind(resolve_in_project(&root.0, "\\x")), ErrorKind::OutsideProject);
        assert_eq!(kind(resolve_in_project(&root.0, "CON")), ErrorKind::InvalidName);
        assert_eq!(kind(resolve_in_project(&root.0, "a\\CON.txt")), ErrorKind::InvalidName);
        assert_eq!(kind(resolve_in_project(&root.0, "name.")), ErrorKind::InvalidName);
    }

    #[test]
    fn resolve_in_project_rejects_a_junction_that_leads_outside() {
        let root = TempDir::new("resolve-junction");
        let outside = TempDir::new("resolve-junction-target");
        let link = root.0.join("escape");
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside.0)
            .output()
            .is_ok_and(|output| output.status.success());
        if !made {
            eprintln!("skipping: could not create a junction");
            return;
        }
        assert_eq!(kind(resolve_in_project(&root.0, "escape\\secret.tex")), ErrorKind::OutsideProject);
        let _ = fs::remove_dir(&link);
    }

    // ----- project texts (spec 007) -----

    #[test]
    fn project_texts_returns_text_files_only() {
        let root = TempDir::new("texts");
        fs::create_dir_all(root.0.join("chapters")).unwrap();
        fs::create_dir_all(root.0.join(".git")).unwrap();
        fs::write(root.0.join("main.tex"), "\\documentclass{article}").unwrap();
        fs::write(root.0.join("chapters").join("one.tex"), "One").unwrap();
        fs::write(root.0.join("refs.bib"), "@book{k,}").unwrap();
        fs::write(root.0.join("main.aux"), "clutter").unwrap();
        fs::write(root.0.join("fig.png"), [0u8, 1, 2]).unwrap();
        fs::write(root.0.join(".git").join("config.txt"), "hidden").unwrap();
        fs::write(root.0.join("latin1.tex"), [0xE9u8, 0x20]).unwrap();
        fs::write(root.0.join("big.txt"), vec![b'a'; (MAX_TEXT_BYTES + 1) as usize]).unwrap();
        let texts = project_texts_at(&root.0, None).unwrap();
        let paths: Vec<&str> = texts.files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(paths, ["chapters\\one.tex", "main.tex", "refs.bib"]);
        assert!(!texts.truncated);
        assert_eq!(texts.files[1].text, "\\documentclass{article}");
        assert!(texts.files[1].modified > 0);
    }

    #[test]
    fn project_texts_reads_only_the_named_paths() {
        let root = TempDir::new("texts-paths");
        fs::write(root.0.join("a.tex"), "A").unwrap();
        fs::write(root.0.join("b.tex"), "B").unwrap();
        let names = ["b.tex", "missing.tex", "..\\outside.tex", "a.tex"].map(String::from);
        let texts = project_texts_at(&root.0, Some(&names)).unwrap();
        let paths: Vec<&str> = texts.files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(paths, ["b.tex", "a.tex"]);
    }

    #[test]
    fn notes_file_is_the_only_editable_json() {
        let root = TempDir::new("notes-file");
        fs::create_dir_all(root.0.join(".lexy")).unwrap();
        write_file_at(&root.0, ".lexy\\notes.json", "{\"version\":1,\"notes\":[]}").unwrap();
        assert_eq!(read_file_at(&root.0, ".lexy/notes.json").unwrap(), "{\"version\":1,\"notes\":[]}");
        assert_eq!(kind(write_file_at(&root.0, "notes.json", "{}")), ErrorKind::InvalidName);
        assert_eq!(kind(write_file_at(&root.0, ".lexy\\other.json", "{}")), ErrorKind::InvalidName);
    }

    // ----- copy (spec 007 US5) -----

    #[test]
    fn copy_entry_names_copies_and_never_overwrites() {
        let root = TempDir::new("copy-names");
        fs::create_dir_all(root.0.join("chapters")).unwrap();
        fs::write(root.0.join("chapters").join("one.tex"), "One").unwrap();
        assert_eq!(copy_entry_at(&root.0, "chapters\\one.tex", "chapters").unwrap(), "chapters\\one (copy).tex");
        assert_eq!(copy_entry_at(&root.0, "chapters\\one.tex", "chapters").unwrap(), "chapters\\one (copy 2).tex");
        assert_eq!(fs::read_to_string(root.0.join("chapters").join("one (copy 2).tex")).unwrap(), "One");
        // Into another folder the name stays when it is free.
        assert_eq!(copy_entry_at(&root.0, "chapters\\one.tex", "").unwrap(), "one.tex");
        assert_eq!(copy_entry_at(&root.0, "chapters\\one.tex", "").unwrap(), "one (copy).tex");
        assert_eq!(fs::read_to_string(root.0.join("chapters").join("one.tex")).unwrap(), "One");
    }

    #[test]
    fn copy_entry_copies_folders_but_not_into_themselves() {
        let root = TempDir::new("copy-folders");
        fs::create_dir_all(root.0.join("chapters").join("figs")).unwrap();
        fs::write(root.0.join("chapters").join("figs").join("a.png"), [1u8, 2]).unwrap();
        fs::write(root.0.join("chapters").join("one.tex"), "One").unwrap();
        assert_eq!(copy_entry_at(&root.0, "chapters", "").unwrap(), "chapters (copy)");
        assert_eq!(fs::read(root.0.join("chapters (copy)").join("figs").join("a.png")).unwrap(), [1, 2]);
        assert_eq!(kind(copy_entry_at(&root.0, "chapters", "chapters\\figs")), ErrorKind::InvalidName);
        assert_eq!(kind(copy_entry_at(&root.0, "", "chapters")), ErrorKind::InvalidName);
        assert_eq!(kind(copy_entry_at(&root.0, "missing.tex", "")), ErrorKind::NotFound);
        assert_eq!(kind(copy_entry_at(&root.0, "chapters\\one.tex", "chapters\\one.tex")), ErrorKind::NotFound);
        assert_eq!(kind(copy_entry_at(&root.0, "..\\x.tex", "")), ErrorKind::OutsideProject);
    }

    #[test]
    fn project_texts_does_not_follow_a_junction_out_of_the_project() {
        let root = TempDir::new("texts-junction");
        let outside = TempDir::new("texts-junction-target");
        fs::write(outside.0.join("secret.tex"), "secret").unwrap();
        let link = root.0.join("escape");
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside.0)
            .output()
            .is_ok_and(|output| output.status.success());
        if !made {
            eprintln!("skipping: could not create a junction");
            return;
        }
        let texts = project_texts_at(&root.0, None).unwrap();
        assert!(texts.files.is_empty(), "{:?}", texts.files);
        let _ = fs::remove_dir(&link);
    }

    #[test]
    fn classify_marks_editable_and_build_clutter() {
        assert_eq!(classify("main.tex", false), (true, false));
        assert_eq!(classify("refs.BIB", false), (true, false));
        assert_eq!(classify("fig.png", false), (false, false));
        assert_eq!(classify("main.aux", false), (false, true));
        assert_eq!(classify("main.synctex.gz", false), (false, true));
        assert_eq!(classify("main.run.xml", false), (false, true));
        assert_eq!(classify(".git", true), (false, true));
        assert_eq!(classify("log", true), (false, false), "a folder named like an extension is not clutter");
    }

    // ----- listing and files -----

    fn sample(root: &Path) {
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::create_dir_all(root.join("Images")).unwrap();
        fs::write(root.join("main.tex"), "\\documentclass{article}\n").unwrap();
        fs::write(root.join("b.bib"), "").unwrap();
        fs::write(root.join("main.aux"), "").unwrap();
        fs::write(root.join("chapters").join("intro.tex"), "Intro").unwrap();
    }

    #[test]
    fn list_dir_sorts_folders_first_and_flags_entries() {
        let root = TempDir::new("list");
        sample(&root.0);
        let names: Vec<_> = list_dir_at(&root.0, "").unwrap().into_iter().map(|e| (e.name, e.kind, e.editable, e.hidden)).collect();
        assert_eq!(
            names,
            vec![
                ("chapters".into(), "folder", false, false),
                ("Images".into(), "folder", false, false),
                ("b.bib".into(), "file", true, false),
                ("main.aux".into(), "file", false, true),
                ("main.tex".into(), "file", true, false),
            ]
        );
        let inner = list_dir_at(&root.0, "chapters").unwrap();
        assert_eq!(inner[0].path, "chapters\\intro.tex");
    }

    #[test]
    fn count_entries_stops_at_the_limit_and_skips_hidden() {
        let root = TempDir::new("count");
        sample(&root.0);
        assert_eq!(count_entries_at(&root.0, 100), 5); // chapters, Images, main.tex, b.bib, chapters\intro.tex
        assert_eq!(count_entries_at(&root.0, 3), 3);
    }

    #[test]
    fn read_and_write_files_inside_the_project() {
        let root = TempDir::new("files");
        sample(&root.0);
        write_file_at(&root.0, "chapters/intro.tex", "Changed").unwrap();
        assert_eq!(read_file_at(&root.0, "chapters\\intro.tex").unwrap(), "Changed");
        assert_eq!(kind(read_file_at(&root.0, "main.aux")), ErrorKind::InvalidName);
        assert_eq!(kind(write_file_at(&root.0, "tool.exe", "x")), ErrorKind::InvalidName);
        assert_eq!(kind(write_file_at(&root.0, "nowhere/x.tex", "x")), ErrorKind::NotFound);
        assert_eq!(kind(read_file_at(&root.0, "missing.tex")), ErrorKind::NotFound);
        fs::write(root.0.join("latin1.tex"), [0xE9u8]).unwrap();
        assert!(read_file_at(&root.0, "latin1.tex").is_err());
    }

    #[test]
    fn create_rename_and_delete_entries() {
        let root = TempDir::new("crud");
        sample(&root.0);
        create_file_at(&root.0, "chapters/two.tex").unwrap();
        assert_eq!(kind(create_file_at(&root.0, "chapters/two.tex")), ErrorKind::NameTaken);
        create_folder_at(&root.0, "figures").unwrap();
        assert_eq!(kind(create_folder_at(&root.0, "figures")), ErrorKind::NameTaken);

        rename_entry_at(&root.0, "chapters/two.tex", "figures/two.tex").unwrap();
        assert!(root.0.join("figures").join("two.tex").is_file());
        assert_eq!(kind(rename_entry_at(&root.0, "figures/two.tex", "main.tex")), ErrorKind::NameTaken);
        assert_eq!(kind(rename_entry_at(&root.0, "figures/two.tex", "..\\two.tex")), ErrorKind::OutsideProject);
        assert_eq!(kind(rename_entry_at(&root.0, "chapters", "chapters/inner")), ErrorKind::InvalidName);
        rename_entry_at(&root.0, "main.tex", "Main.tex").unwrap(); // case-only rename

        assert_eq!(kind(delete_entry_at(&root.0, "", false)), ErrorKind::OutsideProject);
        assert_eq!(kind(delete_entry_at(&root.0, "nothing.tex", true)), ErrorKind::NotFound);
        delete_entry_at(&root.0, "figures", true).unwrap();
        assert!(!root.0.join("figures").exists());
        // The Recycle Bin may be unavailable for temp folders; either outcome is acceptable.
        match delete_entry_at(&root.0, "b.bib", false) {
            Ok(()) => assert!(!root.0.join("b.bib").exists()),
            Err(error) => assert_eq!(error.kind, ErrorKind::NoRecycleBin),
        }
    }

    #[test]
    fn import_files_handles_conflicts() {
        let root = TempDir::new("import");
        let outside = TempDir::new("import-src");
        sample(&root.0);
        fs::write(outside.0.join("fig.png"), b"new").unwrap();
        fs::create_dir_all(outside.0.join("data")).unwrap();
        fs::write(outside.0.join("data").join("a.csv"), b"1").unwrap();
        let sources = vec![outside.0.join("fig.png").display().to_string(), outside.0.join("data").display().to_string()];

        let first = import_files_at(&root.0, &sources, "Images", OnConflict::Ask).unwrap();
        assert_eq!(first.copied, vec!["Images\\fig.png", "Images\\data"]);
        assert!(root.0.join("Images").join("data").join("a.csv").is_file());

        let again = import_files_at(&root.0, &sources[..1], "Images", OnConflict::Ask).unwrap();
        assert_eq!(again.conflicts, vec![sources[0].clone()]);
        assert!(again.copied.is_empty());

        let both = import_files_at(&root.0, &sources[..1], "Images", OnConflict::KeepBoth).unwrap();
        assert_eq!(both.copied, vec!["Images\\fig (2).png"]);
        let skipped = import_files_at(&root.0, &sources[..1], "Images", OnConflict::Skip).unwrap();
        assert_eq!(skipped.skipped.len(), 1);
        fs::write(outside.0.join("fig.png"), b"newer").unwrap();
        import_files_at(&root.0, &sources[..1], "Images", OnConflict::Replace).unwrap();
        assert_eq!(fs::read(root.0.join("Images").join("fig.png")).unwrap(), b"newer");

        assert_eq!(kind(import_files_at(&root.0, &sources, "..", OnConflict::Ask)), ErrorKind::OutsideProject);
    }

    // ----- main document -----

    #[test]
    fn declares_document_ignores_comments_and_body() {
        assert!(declares_document("% !TEX program = xelatex\n\\documentclass[12pt]{article}\n"));
        assert!(!declares_document("%\\documentclass{article}\nText"));
        assert!(!declares_document("  % \\documentclass{article}"));
        assert!(!declares_document("\\begin{document}\n\\documentclass{article}"));
        assert!(!declares_document("\\section{Intro}"));
    }

    #[test]
    fn detect_main_needs_exactly_one_candidate() {
        let root = TempDir::new("main");
        sample(&root.0);
        assert_eq!(detect_main(&root.0), (Some("main.tex".into()), vec!["main.tex".into()]));
        fs::write(root.0.join("other.tex"), "\\documentclass{report}").unwrap();
        assert_eq!(detect_main(&root.0), (None, vec!["main.tex".into(), "other.tex".into()]));
        fs::write(root.0.join("other.tex"), "%\\documentclass{report}").unwrap();
        assert_eq!(detect_main(&root.0).0.as_deref(), Some("main.tex"));
        let empty = TempDir::new("main-empty");
        assert_eq!(detect_main(&empty.0), (None, vec![]));
    }

    // ----- store -----

    #[test]
    fn store_round_trips_dedups_and_caps() {
        let dir = TempDir::new("store");
        let mut store = load_store(&dir.0);
        assert_eq!(store, Store::default());
        for n in 0..25 {
            store.touch(&format!("D:\\P{n}"), n);
        }
        store.touch("d:\\p3\\", 100);
        assert_eq!(store.projects.len(), 20);
        assert_eq!(store.projects[0].path, "d:\\p3\\");
        assert_eq!(store.projects.iter().filter(|p| same_path(&p.path, "D:\\P3")).count(), 1);
        store.set_main("d:\\p3", "thesis.tex");
        store.last_open = Some("d:\\p3".into());
        save_store(&dir.0, &store).unwrap();
        let loaded = load_store(&dir.0);
        assert_eq!(loaded, store);
        assert_eq!(loaded.entry("D:\\P3").and_then(|e| e.main_document.as_deref()), Some("thesis.tex"));
        let mut forgotten = loaded;
        forgotten.forget("D:\\P3");
        assert!(forgotten.entry("d:\\p3").is_none() && forgotten.last_open.is_none());
    }

    #[test]
    fn store_with_bad_json_or_version_starts_empty_and_keeps_a_backup() {
        let dir = TempDir::new("store-bad");
        fs::write(dir.0.join("projects.json"), "{not json").unwrap();
        assert_eq!(load_store(&dir.0), Store::default());
        assert!(dir.0.join("projects.json.bak").is_file());
        fs::write(dir.0.join("projects.json"), r#"{"version":9,"lastOpen":null,"projects":[]}"#).unwrap();
        assert_eq!(load_store(&dir.0), Store::default());
    }

    #[test]
    fn store_serializes_camel_case() {
        let mut store = Store::default();
        store.touch("D:\\Thesis", 5);
        store.set_main("D:\\Thesis", "thesis.tex");
        let json = serde_json::to_value(&store).unwrap();
        assert_eq!(json["lastOpen"], serde_json::Value::Null);
        assert_eq!(json["projects"][0]["mainDocument"], "thesis.tex");
        assert_eq!(json["projects"][0]["lastOpened"], 5);
    }

    // ----- Project Home -----

    #[test]
    fn list_projects_merges_default_folder_and_recent() {
        let home = TempDir::new("home");
        let outside = TempDir::new("home-outside");
        fs::create_dir_all(home.0.join("Old")).unwrap();
        fs::create_dir_all(home.0.join("Recent")).unwrap();
        fs::create_dir_all(home.0.join(".hidden")).unwrap();
        fs::write(home.0.join("loose.tex"), "").unwrap();
        let mut store = Store::default();
        store.touch(&home.0.join("Recent").display().to_string(), 50);
        store.touch(&outside.0.display().to_string(), 40);
        store.touch("Z:\\Gone\\Missing", 30);

        let projects = list_projects_at(&home.0, &store);
        let names: Vec<_> = projects.iter().map(|p| (p.name.as_str(), p.in_default_folder, p.missing)).collect();
        assert_eq!(names[0], ("Recent", true, false));
        assert_eq!(names[1].1, false, "outside project");
        assert_eq!(names[2], ("Missing", false, true));
        assert_eq!(names[3], ("Old", true, false));
        assert_eq!(projects.len(), 4, "no duplicates, no hidden folders, no loose files");
    }

    #[test]
    fn create_project_never_overwrites() {
        let home = TempDir::new("create");
        let first = create_project_at(&home.0, "Thesis", "starter").unwrap();
        assert_eq!(fs::read_to_string(first.join("Thesis.tex")).unwrap(), "starter");
        let second = create_project_at(&home.0, "Thesis", "starter").unwrap();
        assert_eq!(second, home.0.join("Thesis (2)"));
        assert!(second.join("Thesis (2).tex").is_file());
        assert_eq!(kind(create_project_at(&home.0, "a:b", "")), ErrorKind::InvalidName);
        assert_eq!(kind(create_project_at(&home.0, "  ", "")), ErrorKind::InvalidName);
    }

    #[test]
    fn second_lock_on_the_same_project_is_refused() {
        let locks = TempDir::new("locks");
        let root = TempDir::new("locked");
        let first = acquire_lock(&locks.0, &root.0).unwrap();
        assert!(first.is_some());
        assert!(acquire_lock(&locks.0, &root.0).unwrap().is_none(), "second open must be read-only");
        drop(first);
        assert!(acquire_lock(&locks.0, &root.0).unwrap().is_some());
    }

    #[test]
    fn watcher_ignores_clutter_temp_files_and_own_writes() {
        let root = TempDir::new("watch");
        sample(&root.0);
        let writes: RecentWrites = Arc::default();
        assert_eq!(watcher_relevant(&root.0, &root.0.join("chapters").join("intro.tex"), &writes).as_deref(), Some("chapters\\intro.tex"));
        assert_eq!(watcher_relevant(&root.0, &root.0.join("main.aux"), &writes), None);
        assert_eq!(watcher_relevant(&root.0, &root.0.join(".main.tex.lexy-tmp"), &writes), None);
        assert_eq!(watcher_relevant(&root.0, &root.0.join(".git").join("index"), &writes), None);
        let main = root.0.join("main.tex");
        let modified = fs::metadata(&main).unwrap().modified().unwrap();
        writes.lock().unwrap().insert(main.clone(), modified);
        assert_eq!(watcher_relevant(&root.0, &main, &writes), None);
    }

    #[test]
    fn errors_serialize_with_camel_case_kind() {
        let json = serde_json::to_value(ProjectError::new(ErrorKind::NoRecycleBin, "x")).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "noRecycleBin", "message": "x" }));
    }
}
