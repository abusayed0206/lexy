//! Offline spell check (spec 007 US1, research R4): Hunspell dictionaries through `spellbook`.
//! Bundled dictionaries live in the app's resources; more can be dropped into
//! %LOCALAPPDATA%\Lexy\Dictionaries as `<lang>.aff` + `<lang>.dic`. Personal words are kept in
//! %LOCALAPPDATA%\Lexy\dictionary.txt, one per line.

use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, State};

const MAX_WORDS: usize = 2000;
const MAX_SUGGESTIONS: usize = 8;

/// Dictionaries by language plus the personal word list, loaded on first use.
#[derive(Default)]
pub struct Speller {
    dictionaries: HashMap<String, spellbook::Dictionary>,
    personal: Option<HashSet<String>>,
}

#[derive(Default, Clone)]
pub struct SpellState(pub Arc<Mutex<Speller>>);

/// Where to look for dictionaries and the personal list (testable without Tauri).
pub struct SpellPaths {
    pub dictionary_dirs: Vec<PathBuf>,
    pub personal_file: PathBuf,
}

fn valid_lang(lang: &str) -> bool {
    !lang.is_empty() && lang.len() <= 20 && lang.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

impl Speller {
    fn personal(&mut self, paths: &SpellPaths) -> &mut HashSet<String> {
        self.personal.get_or_insert_with(|| {
            fs::read_to_string(&paths.personal_file)
                .map(|text| text.lines().map(str::trim).filter(|w| !w.is_empty()).map(str::to_string).collect())
                .unwrap_or_default()
        })
    }

    fn dictionary(&mut self, lang: &str, paths: &SpellPaths) -> Result<&spellbook::Dictionary, String> {
        if !valid_lang(lang) {
            return Err(format!("Dictionary \"{lang}\" is not installed"));
        }
        if !self.dictionaries.contains_key(lang) {
            let found = paths.dictionary_dirs.iter().find(|dir| dir.join(format!("{lang}.aff")).is_file() && dir.join(format!("{lang}.dic")).is_file());
            let dir = found.ok_or_else(|| format!("Dictionary \"{lang}\" is not installed"))?;
            let read = |ext: &str| fs::read_to_string(dir.join(format!("{lang}.{ext}"))).map_err(|error| format!("Could not read the {lang} dictionary: {error}"));
            let dictionary = spellbook::Dictionary::new(&read("aff")?, &read("dic")?)
                .map_err(|error| format!("The {lang} dictionary is damaged: {error}"))?;
            self.dictionaries.insert(lang.to_string(), dictionary);
        }
        self.dictionaries.get(lang).ok_or_else(|| format!("Dictionary \"{lang}\" is not installed"))
    }

    /// The words (deduplicated, at most 2,000) that are neither in the dictionary nor personal.
    pub fn check(&mut self, lang: &str, words: &[String], paths: &SpellPaths) -> Result<Vec<String>, String> {
        let personal = self.personal(paths).clone();
        let dictionary = self.dictionary(lang, paths)?;
        let mut seen = HashSet::new();
        Ok(words
            .iter()
            .filter(|word| seen.insert(word.as_str()))
            .take(MAX_WORDS)
            .filter(|word| !personal.contains(word.as_str()) && !dictionary.check(word))
            .cloned()
            .collect())
    }

    pub fn suggest(&mut self, lang: &str, word: &str, paths: &SpellPaths) -> Result<Vec<String>, String> {
        let mut out = Vec::new();
        self.dictionary(lang, paths)?.suggest(word, &mut out);
        out.truncate(MAX_SUGGESTIONS);
        Ok(out)
    }

    pub fn add(&mut self, word: &str, paths: &SpellPaths) -> Result<(), String> {
        let word = word.trim();
        if word.is_empty() || word.len() > 100 || word.contains(char::is_whitespace) {
            return Err("Only single words can be added to the dictionary".into());
        }
        if !self.personal(paths).insert(word.to_string()) {
            return Ok(());
        }
        if let Some(parent) = paths.personal_file.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("Could not save the word: {error}"))?;
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&paths.personal_file)
            .map_err(|error| format!("Could not save the word: {error}"))?;
        writeln!(file, "{word}").map_err(|error| format!("Could not save the word: {error}"))
    }
}

fn spell_paths(app: &AppHandle) -> Result<SpellPaths, String> {
    let local = std::env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join("Lexy")).ok_or("LOCALAPPDATA is not set")?;
    let mut dictionary_dirs = vec![local.join("Dictionaries")];
    if let Ok(resources) = app.path().resource_dir() {
        dictionary_dirs.push(resources.join("resources").join("dictionaries"));
    }
    // `tauri dev` may not have copied resources yet; the source folder has them.
    #[cfg(debug_assertions)]
    dictionary_dirs.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("dictionaries"));
    Ok(SpellPaths { dictionary_dirs, personal_file: local.join("dictionary.txt") })
}

async fn with_speller<T: Send + 'static>(
    app: AppHandle,
    state: State<'_, SpellState>,
    run: impl FnOnce(&mut Speller, &SpellPaths) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let paths = spell_paths(&app)?;
    let speller = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut speller = speller.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        run(&mut speller, &paths)
    })
    .await
    .map_err(|error| format!("spell check failed: {error}"))?
}

#[tauri::command]
pub async fn spell_check(app: AppHandle, state: State<'_, SpellState>, lang: String, words: Vec<String>) -> Result<Vec<String>, String> {
    with_speller(app, state, move |speller, paths| speller.check(&lang, &words, paths)).await
}

#[tauri::command]
pub async fn spell_suggest(app: AppHandle, state: State<'_, SpellState>, lang: String, word: String) -> Result<Vec<String>, String> {
    with_speller(app, state, move |speller, paths| speller.suggest(&lang, &word, paths)).await
}

#[tauri::command]
pub async fn dictionary_add(app: AppHandle, state: State<'_, SpellState>, word: String) -> Result<(), String> {
    with_speller(app, state, move |speller, paths| speller.add(&word, paths)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(label: &str) -> (SpellPaths, PathBuf) {
        let temp = std::env::temp_dir().join(format!("lexy-spell-test-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&temp);
        let bundled = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("dictionaries");
        (SpellPaths { dictionary_dirs: vec![temp.join("Dictionaries"), bundled], personal_file: temp.join("dictionary.txt") }, temp)
    }

    fn words(list: &[&str]) -> Vec<String> {
        list.iter().map(|w| w.to_string()).collect()
    }

    /// The bundled en_US dictionary (resources/dictionaries) parses and knows common words.
    #[test]
    fn bundled_en_us_dictionary_loads() {
        let (paths, _) = paths("bundled");
        let mut speller = Speller::default();
        assert_eq!(speller.check("en_US", &words(&["the", "number", "teh", "Knuth's"]), &paths).unwrap(), ["teh"]);
    }

    #[test]
    fn check_deduplicates_and_suggests_corrections() {
        let (paths, _) = paths("suggest");
        let mut speller = Speller::default();
        assert_eq!(speller.check("en_US", &words(&["teh", "teh", "recieve"]), &paths).unwrap(), ["teh", "recieve"]);
        let suggestions = speller.suggest("en_US", "recieve", &paths).unwrap();
        assert!(suggestions.iter().any(|s| s == "receive"), "{suggestions:?}");
        assert!(suggestions.len() <= MAX_SUGGESTIONS);
    }

    #[test]
    fn personal_words_are_accepted_and_survive_a_reload() {
        let (paths, temp) = paths("personal");
        let mut speller = Speller::default();
        assert_eq!(speller.check("en_US", &words(&["Lexy"]), &paths).unwrap(), ["Lexy"]);
        speller.add("Lexy", &paths).unwrap();
        speller.add("Lexy", &paths).unwrap();
        assert!(speller.check("en_US", &words(&["Lexy"]), &paths).unwrap().is_empty());
        assert_eq!(fs::read_to_string(&paths.personal_file).unwrap(), "Lexy\n");
        let mut fresh = Speller::default();
        assert!(fresh.check("en_US", &words(&["Lexy"]), &paths).unwrap().is_empty());
        assert!(speller.add("two words", &paths).is_err());
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn unknown_or_unsafe_languages_are_refused() {
        let (paths, _) = paths("lang");
        let mut speller = Speller::default();
        assert_eq!(speller.check("xx_YY", &words(&["a"]), &paths).unwrap_err(), "Dictionary \"xx_YY\" is not installed");
        assert!(speller.check("..\\en_US", &words(&["a"]), &paths).is_err());
    }
}
