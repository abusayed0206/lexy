import { invoke } from "@tauri-apps/api/core";
import type { AnnotatedPart } from "./latex/readable";

export type { AnnotatedPart };

/** Mirrors `GrammarIssue` in src-tauri/src/web.rs; offsets are in the concatenated annotated text. */
export type GrammarIssue = { offset: number; length: number; message: string; replacements: string[]; rule: string };

/** The misspelled words among `words` (personal dictionary applied). */
export const spellCheck = (lang: string, words: string[]) => invoke<string[]>("spell_check", { lang, words });
export const spellSuggest = (lang: string, word: string) => invoke<string[]>("spell_suggest", { lang, word });
export const dictionaryAdd = (word: string) => invoke<void>("dictionary_add", { word });
/** Sends the text to `server`; refused unless grammar check is turned on in Settings. */
export const grammarCheck = (server: string, lang: string, annotated: AnnotatedPart[]) =>
  invoke<GrammarIssue[]>("grammar_check", { server, lang, annotated });
/** BibTeX for a DOI from doi.org; only the DOI is sent. */
export const fetchDoi = (doi: string) => invoke<string>("fetch_doi", { doi });
