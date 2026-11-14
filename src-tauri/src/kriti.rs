//! Bangla fonts from the kriti.app catalog (https://kriti.app, free, no API key). The font menu
//! lists the catalog's distributable Unicode families; choosing one copies its files into the
//! project's `fonts` folder (with a notice naming the source and license) so the document
//! compiles anywhere. Catalog fonts can't have pinned hashes (hundreds of them, updated
//! upstream), so downloads are limited to https://kriti.app/fonts/…, capped in size and must
//! be TrueType/OpenType files.

use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use tauri::State;

use crate::{
    project::{resolve_in_project, ErrorKind, ProjectError, ProjectState},
    setup,
};

const BASE: &str = "https://kriti.app";
const INDEX_PATH: &str = "/metadata/search-index.json";
const INDEX_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_FONT_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Entry {
    slug: String,
    name: String,
    family: String,
    designer: String,
    license: String,
    download: String,
    file_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct KritiFamily {
    pub family: String,
    pub designer: String,
    pub license: String,
    pub styles: Vec<String>,
}

/// Font files for `\setmainfont`, as saved in the project's `fonts` folder.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFont {
    pub family: String,
    pub regular: String,
    pub bold: Option<String>,
    pub italic: Option<String>,
    pub bold_italic: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Style {
    Regular,
    Bold,
    Italic,
    BoldItalic,
    Other,
}

fn style_of(entry: &Entry) -> Style {
    let suffix = entry.name.strip_prefix(&entry.family).unwrap_or(&entry.name);
    let key: String = suffix.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase();
    match key.as_str() {
        "" | "regular" | "normal" | "book" | "roman" => Style::Regular,
        "bold" => Style::Bold,
        "italic" | "oblique" => Style::Italic,
        "bolditalic" | "boldoblique" => Style::BoldItalic,
        _ => Style::Other,
    }
}

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().trim().to_string()
}

fn truthy(value: &Value, key: &str) -> bool {
    value.get(key).is_some_and(|v| v.as_bool() == Some(true) || v.as_i64() == Some(1))
}

/// Distributable Unicode fonts with a kriti.app download; color variants are skipped
/// (XeTeX can't draw color glyphs).
fn parse_index(json: &str) -> Result<Vec<Entry>, String> {
    let items: Vec<Value> = serde_json::from_str(json).map_err(|error| format!("the kriti.app catalog is not valid: {error}"))?;
    Ok(items
        .iter()
        .filter(|item| truthy(item, "c") && truthy(item, "t"))
        .map(|item| Entry {
            slug: text(item, "s"),
            name: text(item, "n"),
            family: text(item, "f"),
            designer: text(item, "d"),
            license: text(item, "l"),
            download: text(item, "dl"),
            file_name: text(item, "fn"),
        })
        .filter(|entry| {
            let lower = entry.file_name.to_lowercase();
            !entry.family.is_empty()
                && entry.download.starts_with("/fonts/")
                && !entry.download.contains("..")
                && (lower.ends_with(".ttf") || lower.ends_with(".otf"))
                && !lower.contains(" color")
        })
        .collect())
}

fn families(entries: &[Entry]) -> Vec<KritiFamily> {
    let mut out: Vec<KritiFamily> = Vec::new();
    for entry in entries {
        let style = match style_of(entry) {
            Style::Regular => "Regular",
            Style::Bold => "Bold",
            Style::Italic => "Italic",
            Style::BoldItalic => "Bold Italic",
            Style::Other => continue,
        };
        match out.iter_mut().find(|family| family.family == entry.family) {
            Some(family) if !family.styles.iter().any(|s| s == style) => family.styles.push(style.to_string()),
            Some(_) => {}
            None => out.push(KritiFamily {
                family: entry.family.clone(),
                designer: entry.designer.clone(),
                license: entry.license.clone(),
                styles: vec![style.to_string()],
            }),
        }
    }
    out.retain(|family| family.styles.iter().any(|s| s == "Regular"));
    out.sort_by_key(|family| family.family.to_lowercase());
    out
}

/// One file per style for a family (the first of duplicates wins).
fn pick_files(entries: &[Entry], family: &str) -> Vec<(Style, Entry)> {
    let mut picked: Vec<(Style, Entry)> = Vec::new();
    for entry in entries.iter().filter(|entry| entry.family == family) {
        let style = style_of(entry);
        if style != Style::Other && !picked.iter().any(|(s, _)| *s == style) {
            picked.push((style, entry.clone()));
        }
    }
    picked
}

/// `BCC Purno Regular.ttf` → `BCC-Purno-Regular.ttf` (safe inside `\setmainfont{…}`).
fn safe_file_name(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        let keep = if c.is_ascii_alphanumeric() || c == '.' || c == '_' { c } else { '-' };
        if !(keep == '-' && out.ends_with('-')) {
            out.push(keep);
        }
    }
    out.trim_matches('-').to_string()
}

fn is_font_file(path: &Path) -> bool {
    let Ok(bytes) = fs::read(path) else { return false };
    let size_ok = (12..=MAX_FONT_BYTES as usize).contains(&bytes.len());
    size_ok && matches!(&bytes[..4], [0, 1, 0, 0] | b"OTTO" | b"true")
}

fn cache_dir() -> Result<PathBuf, String> {
    let local = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is not set")?;
    let dir = Path::new(&local).join("Lexy").join("Fonts").join("kriti");
    fs::create_dir_all(&dir).map_err(|error| format!("failed to create the font cache: {error}"))?;
    Ok(dir)
}

/// The catalog, refreshed once a day.
fn load_index() -> Result<Vec<Entry>, String> {
    let path = cache_dir()?.join("search-index.json");
    let stale = fs::metadata(&path)
        .and_then(|m| m.modified())
        .map(|modified| SystemTime::now().duration_since(modified).unwrap_or_default() > INDEX_MAX_AGE)
        .unwrap_or(true);
    if stale {
        let _ = fs::remove_file(&path);
        if let Err(error) = setup::download(&format!("{BASE}{INDEX_PATH}"), &path, None, &mut |_, _| {}) {
            return Err(error);
        }
    }
    let json = fs::read_to_string(&path).map_err(|error| format!("failed to read the kriti.app catalog: {error}"))?;
    parse_index(&json)
}

fn notice(family: &str, files: &[(Style, Entry)]) -> String {
    let first = &files[0].1;
    let mut text = format!(
        "{family}\nDesigner: {}\nLicense: {}\nDownloaded by Lexy from the kriti.app catalog:\n",
        if first.designer.is_empty() { "unknown" } else { &first.designer },
        if first.license.is_empty() { "see the font's own metadata" } else { &first.license },
    );
    for (_, entry) in files {
        text.push_str(&format!("  {} - {BASE}/fonts/{}\n", entry.file_name, entry.slug));
    }
    text
}

/// Download (cached) and copy a family's files into `<folder>/fonts`.
fn install(entries: &[Entry], family: &str, folder: &Path, cache: &Path) -> Result<ProjectFont, String> {
    let files = pick_files(entries, family);
    if !files.iter().any(|(style, _)| *style == Style::Regular) {
        return Err(format!("{family} has no regular style in the kriti.app catalog"));
    }
    let target = folder.join("fonts");
    fs::create_dir_all(&target).map_err(|error| format!("failed to create the fonts folder: {error}"))?;
    let mut font = ProjectFont { family: family.to_string(), ..Default::default() };
    for (style, entry) in &files {
        let ext = if entry.file_name.to_lowercase().ends_with(".otf") { "otf" } else { "ttf" };
        let cached = cache.join(format!("{}.{ext}", safe_file_name(&entry.slug)));
        setup::download(&format!("{BASE}{}", entry.download), &cached, None, &mut |_, _| {})?;
        if !is_font_file(&cached) {
            let _ = fs::remove_file(&cached);
            return Err(format!("{} from kriti.app is not a font file", entry.file_name));
        }
        let name = safe_file_name(&entry.file_name);
        fs::copy(&cached, target.join(&name)).map_err(|error| format!("failed to copy {name}: {error}"))?;
        let slot = match style {
            Style::Regular => &mut font.regular,
            Style::Bold => font.bold.get_or_insert_with(String::new),
            Style::Italic => font.italic.get_or_insert_with(String::new),
            Style::BoldItalic => font.bold_italic.get_or_insert_with(String::new),
            Style::Other => continue,
        };
        *slot = name;
    }
    let notice_name = format!("{}-NOTICE.txt", safe_file_name(family));
    fs::write(target.join(notice_name), notice(family, &files)).map_err(|error| format!("failed to write the font notice: {error}"))?;
    Ok(font)
}

#[tauri::command]
pub async fn kriti_fonts() -> Result<Vec<KritiFamily>, String> {
    tauri::async_runtime::spawn_blocking(|| load_index().map(|entries| families(&entries)))
        .await
        .map_err(|error| error.to_string())?
}

/// Copy a kriti.app family into the `fonts` folder next to the main document.
#[tauri::command]
pub async fn install_kriti_font(state: State<'_, ProjectState>, main: String, family: String) -> Result<ProjectFont, ProjectError> {
    let folder = state.with(|project| {
        if project.read_only {
            return Err(ProjectError::new(ErrorKind::ReadOnly, "this project is open in another Lexy window"));
        }
        let path = resolve_in_project(&project.root, &main)?;
        Ok(path.parent().map(Path::to_path_buf).unwrap_or_else(|| project.root.clone()))
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        let entries = load_index()?;
        install(&entries, &family, &folder, &cache_dir()?).map_err(ProjectError::from)
    })
    .await
    .map_err(|error| ProjectError::new(ErrorKind::Io, format!("task failed: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"[
      {"s":"9bf9b20f","n":"BCC Purno Regular","f":"BCC Purno","d":"Bangladesh Computer Council","c":1,"l":"Government","t":1,"dl":"/fonts/BCC%20Purno%20Regular.ttf","fn":"BCC Purno Regular.ttf"},
      {"s":"0374bbd5","n":"BCC Purno Regular","f":"BCC Purno","d":"Bangladesh Computer Council","c":1,"l":"Government","t":1,"dl":"/fonts/BCC%20Purno%20Regular%20Color.ttf","fn":"BCC Purno Regular Color.ttf"},
      {"s":"b1","n":"BCC Purno Bold","f":"BCC Purno","d":"Bangladesh Computer Council","c":1,"l":"Government","t":1,"dl":"/fonts/BCC%20Purno%20Bold.ttf","fn":"BCC Purno Bold.ttf"},
      {"s":"b2","n":"BCC Purno Bold-Italic","f":"BCC Purno","d":"Bangladesh Computer Council","c":1,"l":"Government","t":1,"dl":"/fonts/BCC%20Purno%20Bold-Italic.ttf","fn":"BCC Purno Bold-Italic.ttf"},
      {"s":"k1","n":"Kalpurush","f":"Kalpurush","d":"","c":1,"l":"OFL","t":1,"dl":"/fonts/Kalpurush.ttf","fn":"Kalpurush.ttf"},
      {"s":"k2","n":"Kalpurush ANSI","f":"Kalpurush ANSI","d":"","c":1,"l":"OFL","t":0,"dl":"/fonts/Kalpurush%20ANSI.ttf","fn":"Kalpurush ANSI.ttf"},
      {"s":"x1","n":"Paid","f":"Paid","d":"","c":0,"l":"Unknown","t":1,"dl":"","ex":"https://example.com","fn":"Paid.ttf"},
      {"s":"x2","n":"Evil","f":"Evil","d":"","c":1,"l":"OFL","t":1,"dl":"/fonts/../x.ttf","fn":"Evil.ttf"},
      {"s":"l1","n":"Hind Light","f":"Hind","d":"","c":1,"l":"OFL","t":1,"dl":"/fonts/Hind%20Light.ttf","fn":"Hind Light.ttf"}
    ]"#;

    #[test]
    fn lists_distributable_unicode_families_with_their_styles() {
        let entries = parse_index(SAMPLE).unwrap();
        let got = families(&entries);
        let view: Vec<_> = got.iter().map(|f| (f.family.as_str(), f.styles.join("+"), f.license.as_str())).collect();
        assert_eq!(view, [("BCC Purno", "Regular+Bold+Bold Italic".to_string(), "Government"), ("Kalpurush", "Regular".to_string(), "OFL")]);
        assert!(parse_index("not json").is_err());
    }

    #[test]
    fn picks_one_file_per_style_and_makes_safe_names() {
        let entries = parse_index(SAMPLE).unwrap();
        let picked = pick_files(&entries, "BCC Purno");
        assert_eq!(picked.iter().map(|(_, e)| e.file_name.as_str()).collect::<Vec<_>>(), ["BCC Purno Regular.ttf", "BCC Purno Bold.ttf", "BCC Purno Bold-Italic.ttf"]);
        assert_eq!(safe_file_name("BCC Purno Bold-Italic.ttf"), "BCC-Purno-Bold-Italic.ttf");
        assert_eq!(safe_file_name("আমার font (1).ttf"), "font-1-.ttf".trim_start_matches('-'));
    }

    #[test]
    fn installs_from_the_cache_and_rejects_non_fonts() {
        let base = std::env::temp_dir().join(format!("lexy-kriti-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let (cache, project) = (base.join("cache"), base.join("project"));
        fs::create_dir_all(&cache).unwrap();
        fs::create_dir_all(&project).unwrap();
        let entries = parse_index(SAMPLE).unwrap();
        // Pre-filled cache: `download` reuses files when no hash is pinned.
        let mut ttf = vec![0u8, 1, 0, 0];
        ttf.extend([0u8; 64]);
        for slug in ["9bf9b20f", "b1", "b2"] {
            fs::write(cache.join(format!("{slug}.ttf")), &ttf).unwrap();
        }
        let font = install(&entries, "BCC Purno", &project, &cache).unwrap();
        assert_eq!(font.regular, "BCC-Purno-Regular.ttf");
        assert_eq!(font.bold.as_deref(), Some("BCC-Purno-Bold.ttf"));
        assert_eq!(font.italic, None);
        assert_eq!(font.bold_italic.as_deref(), Some("BCC-Purno-Bold-Italic.ttf"));
        assert!(project.join("fonts").join("BCC-Purno-Regular.ttf").is_file());
        let notice = fs::read_to_string(project.join("fonts").join("BCC-Purno-NOTICE.txt")).unwrap();
        assert!(notice.contains("Government") && notice.contains("https://kriti.app/fonts/9bf9b20f"));

        fs::write(cache.join("k1.ttf"), b"<html>not a font</html>").unwrap();
        assert!(install(&entries, "Kalpurush", &project, &cache).unwrap_err().contains("not a font file"));
        assert!(install(&entries, "Hind", &project, &cache).is_err(), "no regular style");
        let json = serde_json::to_value(&font).unwrap();
        assert!(json.get("boldItalic").is_some());
        let _ = fs::remove_dir_all(&base);
    }

    /// Live catalog → Kalpurush in the project → real XeLaTeX compile with shaped conjuncts.
    /// Needs the network and MiKTeX; set LEXY_OFFLINE=1 to skip.
    #[test]
    fn kalpurush_from_the_live_catalog_compiles_with_shaped_conjuncts() {
        if std::env::var_os("LEXY_OFFLINE").is_some() || !crate::detect_environment().ready {
            eprintln!("skipping: offline or LaTeX tools not installed");
            return;
        }
        let base = std::env::temp_dir().join(format!("lexy-kriti-e2e-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let (project, build) = (base.join("project"), base.join("build"));
        fs::create_dir_all(&project).unwrap();
        let entries = load_index().expect("the kriti.app catalog downloads");
        assert!(families(&entries).len() > 50, "the catalog lists many families");
        let font = install(&entries, "Kalpurush", &project, &cache_dir().unwrap()).expect("Kalpurush installs");
        // Same lines as fontLines() for a project font in src/latex/fonts.ts.
        let doc = format!(
            "\\documentclass{{article}}\n\\usepackage{{fontspec}}\n\\setmainfont{{{}}}[Path=fonts/, Script=Bengali]\n\\begin{{document}}\n\\setbox0\\hbox{{ক্ষ}}\\setbox2\\hbox{{ক}}\\setbox4\\hbox{{্}}\\setbox6\\hbox{{ষ}}\\typeout{{LEXYW \\the\\wd0 \\the\\wd2 \\the\\wd4 \\the\\wd6 LEXYW}}\nআমার সোনার বাংলা, ক্ষমা, স্বপ্ন\n\\end{{document}}\n",
            font.regular
        );
        fs::write(project.join("main.tex"), doc).unwrap();
        let root = fs::canonicalize(&project).unwrap();
        let result = crate::compile_project_at(&build, &root, "main.tex", &[]).unwrap();
        assert!(result.ok, "{}\n{}", result.summary, result.log);
        let log = fs::read_to_string(Path::new(result.pdf_path.as_deref().unwrap()).parent().and_then(Path::parent).unwrap().join("main.log"))
            .unwrap()
            .replace(['\r', '\n'], "");
        assert!(log.contains(&font.regular), "the project font file must be used");
        let start = log.find("LEXYW ").unwrap() + 6;
        let end = start + log[start..].find("LEXYW").unwrap();
        let w: Vec<f64> = log[start..end].split("pt").map(str::trim).filter(|v| !v.is_empty()).map(|v| v.parse().unwrap()).collect();
        assert!(w[0] + 0.5 < w[1] + w[2] + w[3], "conjunct not shaped: {w:?}");
        let _ = fs::remove_dir_all(&base);
    }
}
