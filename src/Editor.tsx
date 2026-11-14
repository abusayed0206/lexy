import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { basicSetup } from "codemirror";
import { EditorSelection, EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags } from "@lezer/highlight";
import { indicKeys } from "./indicKeys";
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
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  handle?: Ref<EditorHandle>;
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
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
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
});

export function Editor({ value, onChange, label, handle }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const extensions = useRef<Extension[]>([]);
  /** Saved states of files not on screen, by path. */
  const states = useRef(new Map<string, EditorState>());
  const currentPath = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
    }),
    [],
  );

  useEffect(() => {
    extensions.current = [
      indicKeys,
      basicSetup,
      StreamLanguage.define(stex),
      syntaxHighlighting(latexHighlight),
      lexyTheme,
      EditorView.lineWrapping,
      // Arabic/Hebrew/Urdu lines read right to left; LaTeX-only lines stay left to right.
      EditorView.perLineTextDirection.of(true),
      autoDirection,
      EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
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

  return <div className="editor" ref={host} />;
}
