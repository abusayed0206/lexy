//! App settings in %LOCALAPPDATA%\Lexy\settings.json (spec 007 US6, data-model.md "Settings").
//! Invalid values fall back to their defaults; keys this version doesn't know are kept on save.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{fs, path::{Path, PathBuf}};

use crate::write_atomic;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub editor_font_size: u32,
    pub live_preview_delay_ms: u32,
    pub auto_save: bool,
    pub auto_save_delay_ms: u32,
    pub vim: bool,
    pub spell_check: bool,
    pub spell_language: String,
    pub grammar_check: bool,
    pub grammar_server: String,
    pub image_folder: String,
    pub hide_pdf_in_focus: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            editor_font_size: 14,
            live_preview_delay_ms: 1000,
            auto_save: false,
            auto_save_delay_ms: 5000,
            vim: false,
            spell_check: true,
            spell_language: "en_US".into(),
            grammar_check: false,
            grammar_server: "https://api.languagetool.org".into(),
            image_folder: "figures".into(),
            hide_pdf_in_focus: false,
        }
    }
}

fn number(map: &Map<String, Value>, key: &str, range: std::ops::RangeInclusive<u32>, default: u32) -> u32 {
    map.get(key)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| range.contains(value))
        .unwrap_or(default)
}

fn flag(map: &Map<String, Value>, key: &str, default: bool) -> bool {
    map.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn text(map: &Map<String, Value>, key: &str, valid: impl Fn(&str) -> bool, default: String) -> String {
    map.get(key).and_then(Value::as_str).filter(|value| valid(value)).map(str::to_string).unwrap_or(default)
}

/// Known settings from a JSON object; anything missing or invalid takes its default.
pub fn from_map(map: &Map<String, Value>) -> Settings {
    let d = Settings::default();
    Settings {
        theme: text(map, "theme", |v| matches!(v, "system" | "light" | "dark"), d.theme),
        editor_font_size: number(map, "editorFontSize", 10..=24, d.editor_font_size),
        live_preview_delay_ms: number(map, "livePreviewDelayMs", 300..=5000, d.live_preview_delay_ms),
        auto_save: flag(map, "autoSave", d.auto_save),
        auto_save_delay_ms: number(map, "autoSaveDelayMs", 1000..=60000, d.auto_save_delay_ms),
        vim: flag(map, "vim", d.vim),
        spell_check: flag(map, "spellCheck", d.spell_check),
        spell_language: text(
            map,
            "spellLanguage",
            |v| !v.is_empty() && v.len() <= 20 && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
            d.spell_language,
        ),
        grammar_check: flag(map, "grammarCheck", d.grammar_check),
        grammar_server: text(map, "grammarServer", |v| v.starts_with("https://") && v.len() <= 500, d.grammar_server),
        image_folder: text(map, "imageFolder", crate::project::valid_name, d.image_folder),
        hide_pdf_in_focus: flag(map, "hidePdfInFocus", d.hide_pdf_in_focus),
    }
}

fn read_map(file: &Path) -> Map<String, Value> {
    fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

pub fn load_at(dir: &Path) -> Settings {
    from_map(&read_map(&dir.join("settings.json")))
}

/// Validates `settings`, merges it over the stored object (unknown keys survive) and returns what was stored.
pub fn save_at(dir: &Path, settings: &Settings) -> Result<Settings, String> {
    let file = dir.join("settings.json");
    let incoming = match serde_json::to_value(settings) {
        Ok(Value::Object(map)) => map,
        _ => return Err("failed to encode settings".into()),
    };
    let stored = from_map(&incoming);
    let mut map = read_map(&file);
    if let Ok(Value::Object(known)) = serde_json::to_value(&stored) {
        map.extend(known);
    }
    fs::create_dir_all(dir).map_err(|error| format!("failed to create {}: {error}", dir.display()))?;
    let text = serde_json::to_string_pretty(&Value::Object(map)).map_err(|error| error.to_string())?;
    write_atomic(&file, text.as_bytes())?;
    Ok(stored)
}

pub(crate) fn settings_dir() -> Result<PathBuf, String> {
    std::env::var_os("LOCALAPPDATA")
        .map(|base| PathBuf::from(base).join("Lexy"))
        .ok_or_else(|| "LOCALAPPDATA is not set".to_string())
}

#[tauri::command]
pub fn get_settings() -> Result<Settings, String> {
    Ok(load_at(&settings_dir()?))
}

#[tauri::command]
pub fn set_settings(settings: Settings) -> Result<Settings, String> {
    save_at(&settings_dir()?, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lexy-settings-test-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn missing_file_gives_defaults() {
        let dir = temp("missing");
        assert_eq!(load_at(&dir), Settings::default());
    }

    #[test]
    fn invalid_values_fall_back_to_defaults() {
        let map = json!({
            "theme": "purple", "editorFontSize": 99, "livePreviewDelayMs": "fast", "autoSave": "yes",
            "grammarServer": "http://insecure.example", "imageFolder": "a/b", "spellLanguage": "../x",
            "vim": true, "autoSaveDelayMs": 2000
        });
        let settings = from_map(map.as_object().unwrap());
        let d = Settings::default();
        assert_eq!(settings.theme, d.theme);
        assert_eq!(settings.editor_font_size, d.editor_font_size);
        assert_eq!(settings.live_preview_delay_ms, d.live_preview_delay_ms);
        assert_eq!(settings.auto_save, d.auto_save);
        assert_eq!(settings.grammar_server, d.grammar_server);
        assert_eq!(settings.image_folder, d.image_folder);
        assert_eq!(settings.spell_language, d.spell_language);
        assert!(settings.vim);
        assert_eq!(settings.auto_save_delay_ms, 2000);
    }

    #[test]
    fn save_round_trips_and_keeps_unknown_keys() {
        let dir = temp("save");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), r#"{ "futureOption": 7, "theme": "light" }"#).unwrap();
        let mut settings = load_at(&dir);
        assert_eq!(settings.theme, "light");
        settings.theme = "dark".into();
        settings.editor_font_size = 200;
        let stored = save_at(&dir, &settings).unwrap();
        assert_eq!(stored.theme, "dark");
        assert_eq!(stored.editor_font_size, 14, "out-of-range value stored as the default");
        assert_eq!(load_at(&dir), stored);
        let raw: Value = serde_json::from_str(&fs::read_to_string(dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(raw["futureOption"], 7);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn serializes_camel_case_for_the_frontend() {
        let value = serde_json::to_value(Settings::default()).unwrap();
        for key in ["editorFontSize", "livePreviewDelayMs", "autoSaveDelayMs", "spellLanguage", "grammarServer", "imageFolder", "hidePdfInFocus"] {
            assert!(value.get(key).is_some(), "{key}");
        }
    }
}
