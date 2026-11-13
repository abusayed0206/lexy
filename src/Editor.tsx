import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { basicSetup } from "codemirror";
import { EditorSelection, EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags } from "@lezer/highlight";
import type { Selection, TextEdit } from "./latex/format";

/** Ribbon actions edit the document only through this, so each is exactly one undo step. */
export type EditorHandle = {
  getText: () => string;
  getSelection: () => Selection;
  /** Apply one change; selectFrom/selectTo are offsets in the resulting text. */
  apply: (edit: TextEdit) => void;
  /** Replace the whole document (settings changes), keeping the cursor where it can stay. */
  replaceAll: (text: string) => void;
  focus: () => void;
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
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
    }),
    [],
  );

  useEffect(() => {
    extensions.current = [
      basicSetup,
      StreamLanguage.define(stex),
      syntaxHighlighting(latexHighlight),
      lexyTheme,
      EditorView.lineWrapping,
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
