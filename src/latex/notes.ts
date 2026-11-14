/**
 * Notes on passages (spec 007 US4, data-model.md "Note"), stored in `.lexy\notes.json` so they
 * travel with the project. Offsets are re-found from the quoted text when the file changed.
 */
import { ensurePackage } from "./figure";

export type NoteState = "open" | "resolved" | "detached";
export type Note = {
  id: string;
  file: string;
  from: number;
  to: number;
  quote: string;
  body: string;
  created: string;
  state: NoteState;
};
export type NotesFile = { version: 1; notes: Note[] };

export const NOTES_PATH = ".lexy\\notes.json";
const MAX_QUOTE = 200;
export const MAX_BODY = 2000;

export function newNote(file: string, from: number, to: number, text: string, body: string, now = new Date()): Note {
  return {
    id: `n_${now.getTime()}_${Math.floor(Math.random() * 1000)}`,
    file,
    from,
    to,
    quote: text.slice(from, to).slice(0, MAX_QUOTE),
    body: body.trim().slice(0, MAX_BODY),
    created: now.toISOString(),
    state: "open",
  };
}

/** Notes from `.lexy\notes.json`; anything malformed is dropped rather than failing the project. */
export function parseNotes(json: string): Note[] {
  try {
    const data = JSON.parse(json) as Partial<NotesFile>;
    if (!Array.isArray(data.notes)) return [];
    return data.notes.filter(
      (note): note is Note =>
        !!note &&
        typeof note.id === "string" &&
        typeof note.file === "string" &&
        Number.isInteger(note.from) &&
        Number.isInteger(note.to) &&
        note.from <= note.to &&
        typeof note.quote === "string" &&
        typeof note.body === "string" &&
        ["open", "resolved", "detached"].includes(note.state),
    );
  } catch {
    return [];
  }
}

export function serializeNotes(notes: Note[]): string {
  return `${JSON.stringify({ version: 1, notes } satisfies NotesFile, null, 2)}\n`;
}

/**
 * Where the note's quote is in `text` now: the stored offsets if they still hold it, else the
 * occurrence nearest to them, else the note is detached (its text was removed).
 */
export function reanchor(note: Note, text: string): Note {
  if (!note.quote) return note;
  if (text.slice(note.from, note.from + note.quote.length) === note.quote) return { ...note, to: note.from + note.quote.length, state: note.state === "detached" ? "open" : note.state };
  let best = -1;
  for (let at = text.indexOf(note.quote); at >= 0; at = text.indexOf(note.quote, at + 1)) {
    if (best < 0 || Math.abs(at - note.from) < Math.abs(best - note.from)) best = at;
  }
  if (best < 0) return { ...note, state: "detached" };
  return { ...note, from: best, to: best + note.quote.length, state: note.state === "detached" ? "open" : note.state };
}

/** `\`, `{`, `}`, `#`, `%`, `&`, `_`, `$`, `^`, `~` made safe inside `\todo{…}`. */
export function escapeLatex(text: string): string {
  return text.replace(/[\\{}#%&_$^~]/g, (c) =>
    c === "\\" ? "\\textbackslash{}" : c === "^" ? "\\^{}" : c === "~" ? "\\~{}" : `\\${c}`,
  ).replace(/\s*\n\s*/g, " ");
}

/** `text` with a `\todo{…}` after every open note in it (positions from the end, so offsets stay valid). */
export function injectTodos(text: string, notes: Note[]): string {
  let result = text;
  const open = notes.filter((note) => note.state === "open").sort((a, b) => b.to - a.to);
  for (const note of open) {
    const at = Math.min(note.to, result.length);
    result = `${result.slice(0, at)}\\todo{${escapeLatex(note.body)}}${result.slice(at)}`;
  }
  return result;
}

/** The main document with `\usepackage{todonotes}` added once. */
export function withTodonotes(mainText: string): string {
  const edit = ensurePackage(mainText, "todonotes");
  return edit ? mainText.slice(0, edit.from) + edit.insert + mainText.slice(edit.to) : mainText;
}
