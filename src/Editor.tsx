import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { autocompletion } from "@codemirror/autocomplete";
import { basicSetup } from "codemirror";
import { Compartment, EditorSelection, EditorState, Extension, StateEffect, StateField } from "@codemirror/state";
import { vim } from "@replit/codemirror-vim";
import { latexFolding } from "./latex/folding";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags } from "@lezer/highlight";
import { indicKeys } from "./indicKeys";
import { grammarExtension, mathHover, noteMarks, notesField, recheckSpelling as recheckSpellingEffect, setGrammar, setNoteMarks, spellExtension, type GrammarMark, type NoteMark, type SpellConfig } from "./editorAids";
import { latexCompletions } from "./latex/completions";
import { latexEnvironments } from "./latex/environments";
import { buildIndex, type ProjectIndex } from "./latex/index";
import { tidy } from "./latex/tidy";
import type { Problem } from "./compile";
import type { Selection, TextEdit } from "./latex/format";

/**
 * `dir="auto"` on every visible line, so each line takes its direction from its first strong
 * character (Arabic/Hebrew lines read right to left). perLineTextDirection only reads the
 * direction; this sets it.
 */
const autoDirLine = Decoration.line({ attributes: { dir: "auto" } });
const autoDirection = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const ranges = [];
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          ranges.push(autoDirLine.range(line.from));
          pos = line.to + 1;
        }
      }
      return Decoration.set(ranges);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** A 1 s highlight on the line a jump landed on (spec 003). */
const flashEffect = StateEffect.define<number | null>();
const flashLine = Decoration.line({ class: "cm-flash-line" });
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(flashEffect)) value = effect.value === null ? Decoration.none : Decoration.set([flashLine.range(effect.value)]);
    }
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Compile problems for one file as whole-line diagnostics (lines clamped to the document). */
function diagnosticsFor(state: EditorState, problems: Problem[]): Diagnostic[] {
  return problems
    .filter((problem) => problem.line !== null)
    .map((problem) => {
      const line = state.doc.line(Math.min(Math.max(1, problem.line!), state.doc.lines));
      return { from: line.from, to: line.to, severity: problem.severity, message: problem.message, source: "LaTeX" };
    });
}

/** Ribbon actions edit the document only through this, so each is exactly one undo step. */
export type EditorHandle = {
  getText: () => string;
  getSelection: () => Selection;
  /** Apply one change; selectFrom/selectTo are offsets in the resulting text. */
  apply: (edit: TextEdit) => void;
  /** Replace the whole document (settings changes), keeping the cursor where it can stay. */
  replaceAll: (text: string) => void;
  focus: () => void;
  /**
   * Show another project file (research R7). The outgoing file's state (text, selection,
   * undo history) is kept; `text` is only used the first time a file is shown.
   */
  switchTo: (path: string, text: string) => void;
  /** Current text of any file the editor has shown (null if never shown). */
  textOf: (path: string) => string | null;
  /** Apply an edit to a file that may not be on screen; one undo step there. Returns the new text. */
  applyTo: (path: string, edit: TextEdit) => string | null;
  /** Drop a file's saved state (deleted, or reloaded from disk while not shown). */
  forget: (path: string) => void;
  /** Keep a file's state under its new path after a rename (folder renames move all files below). */
  rename: (from: string, to: string) => void;
  /** Put the cursor at the start of `line` (clamped), scroll it to the middle, focus, flash it. No undo step. */
  jumpToLine: (line: number) => void;
  /** 1-based line of the cursor in the shown file. */
  cursorLine: () => number;
  /** Show compile problems inline in any file the editor has shown (empty list clears). */
  setProblems: (path: string, problems: Problem[]) => void;
  /** Re-indent environments in the shown file (one undo step). */
  tidy: () => void;
  /** The selected text in the shown file ("" when nothing is selected). */
  selectionText: () => string;
  /** Highlight these notes in the shown file (replaces the previous set). */
  setNotes: (marks: NoteMark[]) => void;
  /** Where the shown file's note highlights are now (a note whose text was deleted is missing). */
  notePositions: () => NoteMark[];
  /** Document offset under a window point (drops), or null outside the text. */
  posAtCoords: (x: number, y: number) => number | null;
  /** Keep a state for a file that isn't shown yet, so later `applyTo` edits are undoable there. */
  preload: (path: string, text: string) => void;
  /** Select `from`–`to` in the shown file, scroll it to the middle and focus. No undo step. */
  selectRange: (from: number, to: number) => void;
  /** Grammar marks for the shown file (offsets in its current text); an empty list clears them. */
  setGrammar: (marks: GrammarMark[]) => void;
};

/** Spelling and suggestions (spec 007 US1); without it the editor has neither. */
export type EditorAids = {
  getIndex: () => ProjectIndex;
  spellCheck: boolean;
  /** Vim keys (off by default). */
  vim?: boolean;
  checkWords: (words: string[]) => Promise<string[]>;
  suggest: (word: string) => Promise<string[]>;
  addWord: (word: string) => Promise<void>;
};

type SpellMenu = { word: string; from: number; to: number; x: number; y: number; suggestions: string[] | null };
const EMPTY_INDEX = buildIndex(new Map(), null);

type Props = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  handle?: Ref<EditorHandle>;
  aids?: EditorAids;
  /** The selected text whenever the selection changes ("" for a cursor). */
  onSelectionText?: (text: string) => void;
};

// Colors come from CSS variables so light and dark themes share one definition.
const latexHighlight = HighlightStyle.define([
  { tag: [tags.tagName, tags.keyword], color: "var(--syntax-command)" },
  { tag: [tags.atom, tags.special(tags.variableName)], color: "var(--syntax-environment)" },
  { tag: [tags.bracket], color: "var(--syntax-bracket)" },
  { tag: [tags.number, tags.string], color: "var(--syntax-math)" },
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
]);

const lexyTheme = EditorView.theme({
  "&": { height: "100%", color: "var(--text)", backgroundColor: "var(--editor-bg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "var(--editor-font-size, 14px)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--accent)", padding: "10px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
  ".cm-gutters": {
    backgroundColor: "var(--editor-bg)",
    color: "var(--text-faint)",
    border: "none",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--active-line)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--selection)" },
  ".cm-matchingBracket": { backgroundColor: "var(--selection)", outline: "1px solid var(--accent)" },
  // Dotted (spelling) and wavy (grammar) underlines: the line style, not only the color, tells them apart.
  ".cm-spell": { textDecoration: "underline dotted var(--warn-text)", textDecorationThickness: "2px", textUnderlineOffset: "3px" },
  ".cm-grammar": { textDecoration: "underline wavy var(--accent)", textUnderlineOffset: "3px" },
  // Notes: a soft background plus a bottom border, so they show without relying on color alone.
  ".cm-note": { backgroundColor: "var(--warn-bg)", borderBottom: "2px solid var(--warn-text)" },
  // Suggestion list and hover tooltips follow the app theme (CodeMirror's default is light only).
  // One class more than CodeMirror's light base theme (`.ͼ1.ͼ2 .cm-tooltip`), which would otherwise win.
  "&.cm-editor .cm-tooltip.cm-tooltip": { backgroundColor: "var(--surface)", color: "var(--text)", border: "1px solid var(--border-strong)", borderRadius: "6px" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)" },
  "&.cm-editor .cm-tooltip.cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "var(--text)" },
  ".cm-completionDetail": { color: "var(--text-muted)", marginLeft: "1em" },
  ".cm-completionInfo": { color: "var(--text)" },
});

export function Editor({ value, onChange, label, handle, aids, onSelectionText }: Props) {
  const onSelectionRef = useRef(onSelectionText);
  onSelectionRef.current = onSelectionText;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const extensions = useRef<Extension[]>([]);
  /** Saved states of files not on screen, by path. */
  const states = useRef(new Map<string, EditorState>());
  const currentPath = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const aidsRef = useRef(aids);
  aidsRef.current = aids;
  const vimMode = useRef(new Compartment());
  const [spellMenu, setSpellMenu] = useState<SpellMenu | null>(null);
  /** Spell results by word, shared by every file; a word added to the dictionary is set to correct. */
  const knownWords = useRef(new Map<string, boolean>());
  /** "Ignore" for this session. */
  const ignoredWords = useRef(new Set<string>());
  function spellConfig(): SpellConfig | null {
    const current = aidsRef.current;
    if (!current) return null;
    return {
      enabled: current.spellCheck,
      check: current.checkWords,
      onMenu: (target) => {
        setSpellMenu({ ...target, suggestions: null });
        const fill = (suggestions: string[]) => setSpellMenu((menu) => (menu && menu.from === target.from ? { ...menu, suggestions } : menu));
        current.suggest(target.word).then(fill, () => fill([]));
      },
    };
  }

  const stateOf = (path: string) => (path === currentPath.current ? view.current?.state : states.current.get(path));

  useImperativeHandle(
    handle,
    () => ({
      getText: () => view.current?.state.doc.toString() ?? "",
      getSelection: () => {
        const main = view.current?.state.selection.main;
        return { from: main?.from ?? 0, to: main?.to ?? 0 };
      },
      apply: (edit) => {
        view.current?.dispatch({
          changes: { from: edit.from, to: edit.to, insert: edit.insert },
          selection: EditorSelection.single(edit.selectFrom, edit.selectTo),
          scrollIntoView: true,
          userEvent: "input.lexy",
        });
        view.current?.focus();
      },
      replaceAll: (text) => {
        const editor = view.current;
        if (!editor || editor.state.doc.toString() === text) return;
        const head = Math.min(editor.state.selection.main.head, text.length);
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: text },
          selection: EditorSelection.cursor(head),
          userEvent: "input.lexy",
        });
      },
      focus: () => view.current?.focus(),
      switchTo: (path, text) => {
        const editor = view.current;
        if (!editor || path === currentPath.current) return;
        if (currentPath.current !== null) states.current.set(currentPath.current, editor.state);
        const saved = states.current.get(path);
        states.current.delete(path);
        currentPath.current = path;
        editor.setState(saved ?? EditorState.create({ doc: text, extensions: extensions.current }));
        syncVim();
      },
      textOf: (path) => stateOf(path)?.doc.toString() ?? null,
      applyTo: (path, edit) => {
        if (path === currentPath.current) {
          const editor = view.current;
          if (!editor) return null;
          editor.dispatch({
            changes: { from: edit.from, to: edit.to, insert: edit.insert },
            selection: EditorSelection.single(edit.selectFrom, edit.selectTo),
            userEvent: "input.lexy",
          });
          return editor.state.doc.toString();
        }
        const saved = states.current.get(path);
        if (!saved) return null;
        const next = saved.update({
          changes: { from: edit.from, to: edit.to, insert: edit.insert },
          selection: EditorSelection.single(edit.selectFrom, edit.selectTo),
          userEvent: "input.lexy",
        }).state;
        states.current.set(path, next);
        return next.doc.toString();
      },
      forget: (path) => {
        states.current.delete(path);
      },
      rename: (from, to) => {
        const lowerFrom = from.toLowerCase();
        const moved = (path: string) =>
          path.toLowerCase() === lowerFrom || path.toLowerCase().startsWith(`${lowerFrom}\\`) ? to + path.slice(from.length) : path;
        states.current = new Map([...states.current].map(([path, state]) => [moved(path), state]));
        if (currentPath.current !== null) currentPath.current = moved(currentPath.current);
      },
      jumpToLine: (line) => {
        const editor = view.current;
        if (!editor) return;
        const target = editor.state.doc.line(Math.min(Math.max(1, line), editor.state.doc.lines));
        editor.dispatch({
          selection: EditorSelection.cursor(target.from),
          effects: [EditorView.scrollIntoView(target.from, { y: "center" }), flashEffect.of(target.from)],
        });
        editor.focus();
        setTimeout(() => view.current?.dispatch({ effects: flashEffect.of(null) }), 1000);
      },
      cursorLine: () => {
        const state = view.current?.state;
        return state ? state.doc.lineAt(state.selection.main.head).number : 1;
      },
      setProblems: (path, problems) => {
        if (path === currentPath.current) {
          const editor = view.current;
          if (editor) editor.dispatch(setDiagnostics(editor.state, diagnosticsFor(editor.state, problems)));
          return;
        }
        const saved = states.current.get(path);
        if (saved) states.current.set(path, saved.update(setDiagnostics(saved, diagnosticsFor(saved, problems))).state);
      },
      tidy: () => {
        const editor = view.current;
        if (!editor) return;
        const text = editor.state.doc.toString();
        const next = tidy(text);
        if (next === text) return;
        const head = Math.min(editor.state.selection.main.head, next.length);
        editor.dispatch({ changes: { from: 0, to: text.length, insert: next }, selection: EditorSelection.cursor(head), userEvent: "input.lexy" });
      },
      selectionText: () => {
        const state = view.current?.state;
        return state ? state.sliceDoc(state.selection.main.from, state.selection.main.to) : "";
      },
      setGrammar: (marks) => view.current?.dispatch({ effects: setGrammar.of(marks) }),
      setNotes: (marks) => view.current?.dispatch({ effects: setNoteMarks.of(marks) }),
      notePositions: () => (view.current ? noteMarks(view.current.state) : []),
      posAtCoords: (x, y) => view.current?.posAtCoords({ x, y }) ?? null,
      preload: (path, text) => {
        if (path === currentPath.current || states.current.has(path)) return;
        states.current.set(path, EditorState.create({ doc: text, extensions: extensions.current }));
      },
      selectRange: (from, to) => {
        const editor = view.current;
        if (!editor) return;
        const length = editor.state.doc.length;
        const [a, b] = [Math.min(from, length), Math.min(to, length)];
        editor.dispatch({ selection: EditorSelection.single(a, b), effects: EditorView.scrollIntoView(a, { y: "center" }) });
        editor.focus();
      },
    }),
    [],
  );

  useEffect(() => {
    extensions.current = [
      // Vim must come before other keymaps so its bindings win (package docs).
      vimMode.current.of(aidsRef.current?.vim ? vim({ status: true }) : []),
      indicKeys,
      basicSetup,
      StreamLanguage.define(stex),
      syntaxHighlighting(latexHighlight),
      lexyTheme,
      flashField,
      lintGutter(),
      autocompletion({ override: [latexCompletions(() => aidsRef.current?.getIndex() ?? EMPTY_INDEX)] }),
      latexFolding,
      latexEnvironments,
      mathHover,
      grammarExtension,
      notesField,
      spellExtension(spellConfig, ignoredWords.current, knownWords.current),
      EditorView.lineWrapping,
      // Arabic/Hebrew/Urdu lines read right to left; LaTeX-only lines stay left to right.
      EditorView.perLineTextDirection.of(true),
      autoDirection,
      EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        if (update.selectionSet) {
          const { from, to } = update.state.selection.main;
          onSelectionRef.current?.(update.state.sliceDoc(from, to));
        }
      }),
    ];
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: value, extensions: extensions.current }),
    });
    view.current = editor;
    return () => editor.destroy();
    // Created once; later `value` changes are handled below.
  }, []);

  // A different document from outside (New/Open) replaces the state, which also
  // resets undo history and does not fire onChange.
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.setState(EditorState.create({ doc: value, extensions: extensions.current }));
    }
  }, [value]);

  function closeMenu() {
    setSpellMenu(null);
    view.current?.focus();
  }

  /** Re-run the spelling pass after the word lists or the setting changed. */
  function recheckSpelling() {
    view.current?.dispatch({ effects: recheckSpellingEffect.of(null) });
  }
  const spellOn = aids?.spellCheck ?? false;
  useEffect(recheckSpelling, [spellOn]);

  /** Apply the Vim setting to the shown state (kept states get it when shown again). */
  function syncVim() {
    const editor = view.current;
    const on = !!aidsRef.current?.vim;
    if (!editor) return;
    const content = vimMode.current.get(editor.state);
    const configured = content !== undefined && !(Array.isArray(content) && content.length === 0);
    if (configured !== on) editor.dispatch({ effects: vimMode.current.reconfigure(on ? vim({ status: true }) : []) });
  }
  const vimSetting = aids?.vim ?? false;
  useEffect(syncVim, [vimSetting]);

  return (
    <div className="editor" ref={host}>
      {spellMenu ? (
        <SpellingMenu
          menu={spellMenu}
          onPick={(word) => {
            const editor = view.current;
            closeMenu();
            if (editor && editor.state.sliceDoc(spellMenu.from, spellMenu.to) === spellMenu.word) {
              editor.dispatch({ changes: { from: spellMenu.from, to: spellMenu.to, insert: word }, userEvent: "input.spell" });
            }
          }}
          onAdd={() => {
            const word = spellMenu.word;
            closeMenu();
            void aidsRef.current?.addWord(word).then(() => {
              knownWords.current.set(word, false);
              recheckSpelling();
            });
          }}
          onIgnore={() => {
            ignoredWords.current.add(spellMenu.word);
            closeMenu();
            recheckSpelling();
          }}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}

/** Right-click menu on a misspelled word: suggestions, Add to dictionary, Ignore. */
function SpellingMenu({
  menu,
  onPick,
  onAdd,
  onIgnore,
  onClose,
}: {
  menu: SpellMenu;
  onPick: (word: string) => void;
  onAdd: () => void;
  onIgnore: () => void;
  onClose: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    list.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu.suggestions]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!list.current?.contains(event.target as Node)) onCloseRef.current();
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") onClose();
    else if (event.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
    else if (event.key === "ArrowUp") items[(at - 1 + items.length) % items.length]?.focus();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  // Fixed to the window, so the editor pane's clipping never cuts it; kept inside the window.
  const left = Math.max(4, Math.min(menu.x, window.innerWidth - 232));
  const top = Math.max(4, Math.min(menu.y, window.innerHeight - 220));
  return (
    <div
      ref={list}
      className="menu-popup spell-menu"
      role="menu"
      aria-label={`Spelling: ${menu.word}`}
      style={{ left, top }}
      onKeyDown={onKeyDown}
    >
      {menu.suggestions === null ? <p className="spell-menu-note">Looking for suggestions</p> : null}
      {menu.suggestions?.length === 0 ? <p className="spell-menu-note">No suggestions</p> : null}
      {menu.suggestions?.map((word) => (
        <button key={word} type="button" role="menuitem" className="menu-item spell-menu-word" onClick={() => onPick(word)}>
          {word}
        </button>
      ))}
      <button type="button" role="menuitem" className="menu-item" onClick={onAdd}>
        Add to dictionary
      </button>
      <button type="button" role="menuitem" className="menu-item" onClick={onIgnore}>
        Ignore
      </button>
    </div>
  );
}
