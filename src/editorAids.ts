/**
 * Editor writing aids (spec 007 US1): spelling marks on prose only, grammar marks from an
 * on-demand check, and a rendered preview when the pointer rests on math.
 */
import { StateEffect, StateField, type Extension, type Range as CmRange } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { mathAt, readableRanges } from "./latex/readable";

// ----- spelling -----

export type SpellConfig = {
  enabled: boolean;
  /** Misspelled words among `words`. */
  check: (words: string[]) => Promise<string[]>;
  /** Right-click on a marked word. */
  onMenu: (target: { word: string; from: number; to: number; x: number; y: number }) => void;
};

/** Only words made of Latin letters are checked; other scripts (Bangla…) are never marked. */
const LATIN_WORD = /^[\p{Script=Latin}][\p{Script=Latin}\p{M}'’]*$/u;
const WORD = /[\p{L}\p{M}][\p{L}\p{M}'’]*/gu;

/** Checkable words in the prose of `text` (offsets relative to `text`): no commands, math, keys, URLs or comments. */
export function spellWords(text: string): { word: string; from: number; to: number }[] {
  const out: { word: string; from: number; to: number }[] = [];
  for (const range of readableRanges(text).text) {
    const slice = text.slice(range.from, range.to);
    for (const m of slice.matchAll(WORD)) {
      const word = m[0].replace(/['’]+$/, "");
      // Skip one-letter words, acronyms (NASA) and words in other scripts.
      if (word.length < 2 || !LATIN_WORD.test(word) || word === word.toUpperCase()) continue;
      if (/^https?$|^www$/i.test(word)) continue;
      out.push({ word, from: range.from + m.index!, to: range.from + m.index! + word.length });
    }
  }
  return out;
}

const spellMark = Decoration.mark({ class: "cm-spell" });
/** Dispatch to re-check the viewport (dictionary or setting changed). */
export const recheckSpelling = StateEffect.define<null>();

export function spellExtension(getConfig: () => SpellConfig | null, ignored: Set<string>, known: Map<string, boolean>): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      timer: ReturnType<typeof setTimeout> | undefined;
      destroyed = false;
      constructor(readonly view: EditorView) {
        this.schedule();
      }
      update(update: ViewUpdate) {
        if (update.docChanged) this.decorations = this.decorations.map(update.changes);
        const recheck = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(recheckSpelling)));
        if (update.docChanged || update.viewportChanged || recheck) this.schedule();
      }
      schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.run(), 400);
      }
      async run() {
        const config = getConfig();
        if (!config?.enabled) {
          if (this.decorations.size && !this.destroyed) {
            this.decorations = Decoration.none;
            this.view.dispatch({});
          }
          return;
        }
        const doc = this.view.state.doc;
        const found: { word: string; from: number; to: number }[] = [];
        for (const { from, to } of this.view.visibleRanges) {
          const start = doc.lineAt(from).from;
          const end = doc.lineAt(to).to;
          for (const hit of spellWords(doc.sliceString(start, end))) found.push({ ...hit, from: hit.from + start, to: hit.to + start });
        }
        const unknown = [...new Set(found.map((hit) => hit.word))].filter((word) => !known.has(word));
        if (unknown.length) {
          try {
            const wrong = new Set(await config.check(unknown));
            for (const word of unknown) known.set(word, wrong.has(word));
          } catch {
            return; // No dictionary: show nothing rather than everything.
          }
        }
        if (this.destroyed || this.view.state.doc !== doc) return; // Closed or edited meanwhile; the next run covers it.
        const marks: CmRange<Decoration>[] = found.filter((hit) => known.get(hit.word) && !ignored.has(hit.word)).map((hit) => spellMark.range(hit.from, hit.to));
        this.decorations = Decoration.set(marks, true);
        this.view.dispatch({});
      }
      destroy() {
        this.destroyed = true;
        clearTimeout(this.timer);
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      eventHandlers: {
        contextmenu(event, view) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) return false;
          let hit: { from: number; to: number } | null = null;
          this.decorations.between(pos, pos, (from, to) => {
            hit = { from, to };
            return false;
          });
          const config = getConfig();
          if (!hit || !config) return false;
          const { from, to } = hit;
          event.preventDefault();
          config.onMenu({ word: view.state.sliceDoc(from, to), from, to, x: event.clientX, y: event.clientY });
          return true;
        },
      },
    },
  );
}

// ----- grammar -----

export type GrammarMark = { from: number; to: number; message: string; replacements: string[] };
export const setGrammar = StateEffect.define<GrammarMark[]>();

class GrammarDecoration {
  constructor(readonly mark: GrammarMark) {}
}

export const grammarField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setGrammar)) {
        value = Decoration.set(
          effect.value
            .filter((mark) => mark.to > mark.from && mark.to <= tr.state.doc.length)
            .map((mark) => Decoration.mark({ class: "cm-grammar", grammar: new GrammarDecoration(mark) }).range(mark.from, mark.to)),
          true,
        );
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const grammarHover = hoverTooltip(
  (view, pos) => {
    let found: { from: number; to: number; mark: GrammarMark } | null = null;
    view.state.field(grammarField).between(pos, pos, (from, to, value) => {
      const spec = value.spec.grammar as GrammarDecoration | undefined;
      if (spec) found = { from, to, mark: spec.mark };
    });
    if (!found) return null;
    const { from, to, mark } = found as { from: number; to: number; mark: GrammarMark };
    return {
      pos: from,
      end: to,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-aid-tooltip";
        const message = document.createElement("p");
        message.textContent = mark.message;
        dom.append(message);
        for (const replacement of mark.replacements) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = replacement || "(remove)";
          button.addEventListener("click", () =>
            view.dispatch({ changes: { from, to, insert: replacement }, userEvent: "input.grammar" }),
          );
          dom.append(button);
        }
        return { dom };
      },
    };
  },
  { hoverTime: 300 },
);

export const grammarExtension: Extension = [grammarField, grammarHover];

// ----- notes (spec 007 US4) -----

export type NoteMark = { id: string; from: number; to: number };
export const setNoteMarks = StateEffect.define<NoteMark[]>();

class NoteId {
  constructor(readonly id: string) {}
}

/** Highlights of open notes, mapped through every edit so they follow their text. */
export const notesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setNoteMarks)) {
        const length = tr.state.doc.length;
        value = Decoration.set(
          effect.value
            .filter((mark) => mark.from < mark.to && mark.to <= length)
            .map((mark) => Decoration.mark({ class: "cm-note", note: new NoteId(mark.id), inclusiveStart: false, inclusiveEnd: false }).range(mark.from, mark.to)),
          true,
        );
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Where each note's highlight is now; a collapsed range means its text was removed. */
export function noteMarks(state: import("@codemirror/state").EditorState): NoteMark[] {
  const marks: NoteMark[] = [];
  const field = state.field(notesField, false);
  field?.between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec.note as NoteId | undefined;
    if (spec) marks.push({ id: spec.id, from, to });
  });
  return marks;
}

// ----- math preview -----

type Katex = { renderToString: (tex: string, options: { displayMode: boolean; throwOnError: boolean }) => string };
let katexModule: Promise<Katex> | null = null;
const loadKatex = () =>
  (katexModule ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([module]) => (module.default ?? module) as Katex));

/** Rendered math after the pointer rests on it for 300 ms (KaTeX is loaded on first use). */
export const mathHover = hoverTooltip(
  async (view, pos) => {
    const text = view.state.doc.toString();
    const math = mathAt(text, pos);
    if (!math) return null;
    const tex = text.slice(math.innerFrom, math.innerTo).trim();
    if (!tex) return null;
    const katex = await loadKatex();
    return {
      pos: math.from,
      end: math.to,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-aid-tooltip cm-math-tooltip";
        try {
          dom.innerHTML = katex.renderToString(tex, { displayMode: math.display, throwOnError: true });
        } catch (error) {
          dom.textContent = `Can't render: ${error instanceof Error ? error.message.replace(/^KaTeX parse error: /, "") : String(error)}`;
        }
        return { dom };
      },
    };
  },
  { hoverTime: 300 },
);
