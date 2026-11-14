//! Bangla documents without a font setup. While compiling, Lexy notices Bangla text in a
//! document that would otherwise go to pdfLaTeX and compiles a copy with XeLaTeX and a
//! Windows font (the user's file is untouched). On request, `install_bangla_font` copies
//! BCC Purno (Bangladesh Computer Council; Bengali + Latin glyphs) into the project's
//! `fonts` folder, so the document compiles on any machine and on Overleaf.

use std::{fs, path::Path};
use tauri::State;

use crate::{
    project::{resolve_in_project, ErrorKind, ProjectError, ProjectState},
    setup, verify_sha256,
};

/// Used for the automatic compile copy; ships with Windows 10/11 and covers Bengali and Latin.
pub const SYSTEM_FONT: &str = "Nirmala UI";

/// (project file name, kriti.app file name, SHA-256). Version 3.000 (EBLICT), from
/// https://kriti.app/fonts/9bf9b20f, verified 2026-11-14.
pub const PURNO_FILES: [(&str, &str, &str); 4] = [
    ("BCCPurno-Regular.ttf", "BCC%20Purno%20Regular.ttf", "9bf9b20fdfcfd4f57421f8673053d0e10a458d408a83a723db2b5e1fe980dea3"),
    ("BCCPurno-Bold.ttf", "BCC%20Purno%20Bold.ttf", "128d8e0e3f71ec9eb0298802bc72e156f2f9de857dee8c5a53545b77cea8a09a"),
    ("BCCPurno-Italic.ttf", "BCC%20Purno%20Italic.ttf", "2e6685860f8d1fdd860bc05348811b0b7481b1a5116a8f6351ec31764b387ac6"),
    ("BCCPurno-BoldItalic.ttf", "BCC%20Purno%20Bold-Italic.ttf", "5e0c048d43d6b4aea4d6b9e0b039fafdcce0b623c08a420dee800e2b307f5ac9"),
];
const PURNO_BASE_URL: &str = "https://kriti.app/fonts/";
pub const NOTICE_FILE: &str = "BCCPurno-NOTICE.txt";
const NOTICE: &str = "BCC Purno (Regular, Bold, Italic, Bold Italic), version 3.000.\n\
Copyright, design and license: Bangladesh Computer Council (EBLICT project).\n\
Downloaded by Lexy from https://kriti.app/fonts/9bf9b20f.\n\
Used under the Bangladesh Computer Council's terms for this font.\n";

/// Bengali letters, signs and digits (U+0980–U+09FF).
pub fn has_bangla(text: &str) -> bool {
    text.chars().any(|c| ('\u{0980}'..='\u{09FF}').contains(&c))
}

/// Text without `%` comments (`\%` is kept).
pub fn without_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        let mut previous = ' ';
        let mut end = line.len();
        for (index, ch) in line.char_indices() {
            if ch == '%' && previous != '\\' {
                end = index;
                break;
            }
            previous = ch;
        }
        out.push_str(&line[..end]);
        out.push('\n');
    }
    out
}

/// The main text with a font setup right after its `\documentclass` line, or `None` when
/// there is no such line.
pub fn with_system_font(main: &str) -> Option<String> {
    let lines: Vec<&str> = main.split_inclusive('\n').collect();
    let index = lines.iter().position(|line| line.trim_start().starts_with("\\documentclass"))?;
    let eol = if main.contains("\r\n") { "\r\n" } else { "\n" };
    let mut out: String = lines[..=index].concat();
    if !out.ends_with('\n') {
        out.push_str(eol);
    }
    // Script=Bengali turns on the font's Bengali shaping (conjuncts, vowel signs); without it
    // XeTeX draws ক্ষ as ক + ্ + ষ.
    out.push_str(&format!("\\usepackage{{fontspec}}{eol}\\setmainfont{{{SYSTEM_FONT}}}[Script=Bengali]{eol}"));
    out.push_str(&lines[index + 1..].concat());
    Some(out)
}

/// Lexy's verified copy of BCC Purno, downloaded once.
fn purno_cache(on_file: &mut dyn FnMut(&str)) -> Result<std::path::PathBuf, String> {
    let local = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is not set")?;
    let dir = Path::new(&local).join("Lexy").join("Fonts").join("BCCPurno");
    fs::create_dir_all(&dir).map_err(|error| format!("failed to create the font folder: {error}"))?;
    for (name, remote, sha) in PURNO_FILES {
        on_file(name);
        setup::download(&format!("{PURNO_BASE_URL}{remote}"), &dir.join(name), Some(sha), &mut |_, _| {})?;
    }
    Ok(dir)
}

/// Copy the font files into `<folder>/fonts` (verified files are kept; others are replaced).
pub fn copy_purno(cache: &Path, folder: &Path) -> Result<Vec<String>, String> {
    let target = folder.join("fonts");
    fs::create_dir_all(&target).map_err(|error| format!("failed to create the fonts folder: {error}"))?;
    let mut written = Vec::new();
    for (name, _, sha) in PURNO_FILES {
        let path = target.join(name);
        if verify_sha256(&path, Some(sha)).is_ok() {
            continue;
        }
        fs::copy(cache.join(name), &path).map_err(|error| format!("failed to copy {name}: {error}"))?;
        written.push(format!("fonts/{name}"));
    }
    let notice = target.join(NOTICE_FILE);
    if !notice.exists() {
        fs::write(&notice, NOTICE).map_err(|error| format!("failed to write {NOTICE_FILE}: {error}"))?;
        written.push(format!("fonts/{NOTICE_FILE}"));
    }
    Ok(written)
}

/// Copy BCC Purno into the `fonts` folder next to the main document. Returns the files written.
#[tauri::command]
pub async fn install_bangla_font(state: State<'_, ProjectState>, main: String) -> Result<Vec<String>, ProjectError> {
    let folder = state.with(|project| {
        if project.read_only {
            return Err(ProjectError::new(ErrorKind::ReadOnly, "this project is open in another Lexy window"));
        }
        let path = resolve_in_project(&project.root, &main)?;
        Ok(path.parent().map(Path::to_path_buf).unwrap_or_else(|| project.root.clone()))
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        let cache = purno_cache(&mut |_| {})?;
        copy_purno(&cache, &folder).map_err(ProjectError::from)
    })
    .await
    .map_err(|error| ProjectError::new(ErrorKind::Io, format!("task failed: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_bangla_and_ignores_comments() {
        assert!(has_bangla("Start writing here. ফসদফদফ দ্ভস্ফাস্ফদ"));
        assert!(!has_bangla("Plain English, café, Ελληνικά"));
        assert!(!has_bangla(&without_comments("Text % বাংলা in a comment\n")));
        assert!(has_bangla(&without_comments("50\\% বাংলা\n")));
    }

    #[test]
    fn adds_the_system_font_after_the_class_line_only() {
        let doc = "\\documentclass{article}\r\n\\title{Untitled}\r\n";
        let out = with_system_font(doc).unwrap();
        assert_eq!(out, "\\documentclass{article}\r\n\\usepackage{fontspec}\r\n\\setmainfont{Nirmala UI}[Script=Bengali]\r\n\\title{Untitled}\r\n");
        assert_eq!(with_system_font("No class here").as_deref(), None);
        assert!(with_system_font("\\documentclass{article}").unwrap().ends_with("\\setmainfont{Nirmala UI}[Script=Bengali]\n"));
    }

    #[test]
    fn copies_verified_fonts_and_keeps_them_on_repeat() {
        let base = std::env::temp_dir().join(format!("lexy-bangla-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let cache = base.join("cache");
        fs::create_dir_all(&cache).unwrap();
        for (name, _, _) in PURNO_FILES {
            fs::write(cache.join(name), name).unwrap();
        }
        let project = base.join("project");
        fs::create_dir_all(&project).unwrap();
        let written = copy_purno(&cache, &project).unwrap();
        assert_eq!(written.len(), 5);
        assert!(fs::read_to_string(project.join("fonts").join(NOTICE_FILE)).unwrap().contains("Bangladesh Computer Council"));
        // The fake files don't match the pinned hashes, so they are copied again; the notice is kept.
        assert_eq!(copy_purno(&cache, &project).unwrap().len(), 4);
        let _ = fs::remove_dir_all(&base);
    }
}
