import { act, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { cursorCharLeft, deleteCharBackward, undo } from "@codemirror/commands";
import { describe, expect, it, vi } from "vitest";
import { Editor, type EditorAids, type EditorHandle } from "./Editor";
import { buildIndex } from "./latex/index";

function mount(value: string, onChange = vi.fn()) {
  const utils = render(<Editor value={value} label="LaTeX source" onChange={onChange} />);
  const content = utils.container.querySelector<HTMLElement>(".cm-content")!;
  const view = EditorView.findFromDOM(content)!;
  return { ...utils, content, view, onChange };
}

describe("Editor", () => {
  it("shows the initial document with an accessible name and no spellcheck", () => {
    const { content, view } = mount("\\section{Intro}");
    expect(view.state.doc.toString()).toBe("\\section{Intro}");
    expect(content).toHaveAttribute("aria-label", "LaTeX source");
    expect(content).toHaveAttribute("spellcheck", "false");
    expect(content).toHaveAttribute("role", "textbox");
  });

  it("reports user edits through onChange", () => {
    const { view, onChange } = mount("abc");
    act(() => view.dispatch({ changes: { from: 3, insert: "d" } }));
    expect(onChange).toHaveBeenCalledWith("abcd");
  });

  it("replaces the document when a new value comes from outside, without echoing onChange", () => {
    const { view, onChange, rerender } = mount("first");
    rerender(<Editor value="second document" label="LaTeX source" onChange={onChange} />);
    expect(view.state.doc.toString()).toBe("second document");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("drops undo history when another document is loaded", () => {
    const { view, onChange, rerender } = mount("first");
    act(() => view.dispatch({ changes: { from: 5, insert: "!" } }));
    rerender(<Editor value="opened file" label="LaTeX source" onChange={onChange} />);
    expect(undo(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("opened file");
  });

  it("keeps the editor state when the value matches what the user typed", () => {
    const { view, onChange, rerender } = mount("abc");
    act(() => view.dispatch({ changes: { from: 3, insert: "d" } }));
    const before = view.state;
    rerender(<Editor value="abcd" label="LaTeX source" onChange={onChange} />);
    expect(view.state).toBe(before);
    expect(undo(view)).toBe(true);
  });

  it("uses the latest onChange callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { view, rerender } = mount("x", first);
    rerender(<Editor value="x" label="LaTeX source" onChange={second} />);
    act(() => view.dispatch({ changes: { from: 1, insert: "y" } }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("xy");
  });

  it("highlights LaTeX commands and comments", () => {
    const { container } = mount("\\section{A} % note");
    const spans = [...container.querySelectorAll(".cm-line span")].map((span) => span.textContent);
    expect(spans).toEqual(expect.arrayContaining(["\\section", "% note"]));
  });

  describe("EditorHandle", () => {
    function mountWithHandle(value: string) {
      const handle: { current: EditorHandle | null } = { current: null };
      const onChange = vi.fn();
      const utils = render(<Editor value={value} label="LaTeX source" onChange={onChange} handle={handle} />);
      const view = EditorView.findFromDOM(utils.container.querySelector<HTMLElement>(".cm-content")!)!;
      return { handle: handle.current!, view, onChange };
    }

    it("reads text and selection", () => {
      const { handle, view } = mountWithHandle("hello world");
      act(() => view.dispatch({ selection: { anchor: 6, head: 11 } }));
      expect(handle.getText()).toBe("hello world");
      expect(handle.getSelection()).toEqual({ from: 6, to: 11 });
    });

    it("applies an edit as one undo step and sets the selection", () => {
      const { handle, view, onChange } = mountWithHandle("make bold");
      act(() => handle.apply({ from: 5, to: 9, insert: "\\textbf{bold}", selectFrom: 13, selectTo: 17 }));
      expect(view.state.doc.toString()).toBe("make \\textbf{bold}");
      expect(handle.getSelection()).toEqual({ from: 13, to: 17 });
      expect(onChange).toHaveBeenLastCalledWith("make \\textbf{bold}");
      act(() => {
        undo(view);
      });
      expect(view.state.doc.toString()).toBe("make bold");
      expect(undo(view)).toBe(false);
    });

    it("replaceAll is one undo step, keeps the cursor in range and skips no-op changes", () => {
      const { handle, view, onChange } = mountWithHandle("0123456789");
      act(() => view.dispatch({ selection: { anchor: 8 } }));
      act(() => handle.replaceAll("abc"));
      expect(view.state.doc.toString()).toBe("abc");
      expect(handle.getSelection()).toEqual({ from: 3, to: 3 });
      onChange.mockClear();
      act(() => handle.replaceAll("abc"));
      expect(onChange).not.toHaveBeenCalled();
      act(() => {
        undo(view);
      });
      expect(view.state.doc.toString()).toBe("0123456789");
    });

  describe("project files", () => {
    it("switchTo keeps each file's text, selection and undo history", () => {
      const { handle, view, onChange } = mountWithHandle("");
      act(() => handle.switchTo("main.tex", "main text"));
      act(() => view.dispatch({ changes: { from: 4, insert: "!" }, selection: { anchor: 5 } }));
      act(() => handle.switchTo("chapters\\intro.tex", "intro"));
      expect(view.state.doc.toString()).toBe("intro");
      expect(undo(view)).toBe(false);
      act(() => handle.switchTo("main.tex", "ignored once shown"));
      expect(view.state.doc.toString()).toBe("main! text");
      expect(handle.getSelection()).toEqual({ from: 5, to: 5 });
      act(() => {
        undo(view);
      });
      expect(view.state.doc.toString()).toBe("main text");
      expect(onChange).toHaveBeenCalledTimes(2); // the typed "!" and its undo, never the switches
    });

    it("textOf reads shown and hidden files", () => {
      const { handle } = mountWithHandle("");
      act(() => handle.switchTo("a.tex", "A"));
      act(() => handle.switchTo("b.tex", "B"));
      expect(handle.textOf("a.tex")).toBe("A");
      expect(handle.textOf("b.tex")).toBe("B");
      expect(handle.textOf("c.tex")).toBeNull();
    });

    it("applyTo edits a hidden file as one undo step there, without onChange", () => {
      const { handle, view, onChange } = mountWithHandle("");
      act(() => handle.switchTo("main.tex", "abc"));
      act(() => handle.switchTo("intro.tex", "intro"));
      onChange.mockClear();
      expect(handle.applyTo("main.tex", { from: 0, to: 0, insert: "X", selectFrom: 1, selectTo: 1 })).toBe("Xabc");
      expect(onChange).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe("intro");
      act(() => handle.switchTo("main.tex", ""));
      expect(view.state.doc.toString()).toBe("Xabc");
      act(() => {
        undo(view);
      });
      expect(view.state.doc.toString()).toBe("abc");
    });

    it("forget and rename manage stored states", () => {
      const { handle } = mountWithHandle("");
      act(() => handle.switchTo("chapters\\a.tex", "A"));
      act(() => handle.switchTo("main.tex", "M"));
      handle.rename("chapters", "parts");
      expect(handle.textOf("parts\\a.tex")).toBe("A");
      expect(handle.textOf("chapters\\a.tex")).toBeNull();
      handle.forget("parts\\a.tex");
      expect(handle.textOf("parts\\a.tex")).toBeNull();
      handle.rename("main.tex", "thesis.tex");
      expect(handle.textOf("thesis.tex")).toBe("M");
    });
  });
  });

  describe("Bangla and other scripts (spec 005)", () => {
    function pressAtEnd(text: string, key: string) {
      const { view } = mount(text);
      act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
      act(() => {
        view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      });
      return view;
    }

    it("Backspace removes one code point after Bangla, like Windows (ক্ষ → ক্, আমি → আম)", () => {
      expect(pressAtEnd("ক্ষ", "Backspace").state.doc.toString()).toBe("ক্");
      expect(pressAtEnd("আমি", "Backspace").state.doc.toString()).toBe("আম");
      expect(pressAtEnd("abc", "Backspace").state.doc.toString()).toBe("ab");
    });

    it("arrow keys step over a whole conjunct and a letter with its vowel sign", () => {
      expect(pressAtEnd("ক্ষ", "ArrowLeft").state.selection.main.head).toBe(0);
      expect(pressAtEnd("আমি", "ArrowLeft").state.selection.main.head).toBe(1);
      const view = mount("ক্ষেত্র").view;
      act(() => view.dispatch({ selection: { anchor: 0 } }));
      act(() => {
        view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      });
      expect(view.state.selection.main.head).toBe(4); // "ক্ষে" is one letter on screen
    });

    it("leaves other text to CodeMirror's own rules", () => {
      // CodeMirror's commands still split the conjunct; the Indic keymap is what fixes it.
      const view = mount("ক্ষ").view;
      act(() => view.dispatch({ selection: { anchor: 3 } }));
      act(() => {
        cursorCharLeft(view);
      });
      expect(view.state.selection.main.head).toBe(2);
      act(() => {
        deleteCharBackward(view);
      });
      expect(view.state.doc.toString()).toBe("কষ"); // only the virama went: the broken result the keymap avoids
    });

    it("lets each line take its own direction (right-to-left scripts)", () => {
      const { view, container } = mount("\\section{x}\nمرحبا");
      expect(view.state.facet(EditorView.perLineTextDirection)).toBe(true);
      const lines = [...container.querySelectorAll(".cm-line")];
      expect(lines.map((line) => line.getAttribute("dir"))).toEqual(["auto", "auto"]);
    });
  });

  it("cleans up the editor on unmount", () => {
    const { view, unmount } = mount("x");
    const destroy = vi.spyOn(view, "destroy");
    unmount();
    expect(destroy).toHaveBeenCalled();
  });
});

describe("Editor writing aids (spec 007 US1)", () => {
  function mountAids(value: string, aids?: Partial<EditorAids>, onSelectionText = vi.fn()) {
    const handle: { current: EditorHandle | null } = { current: null };
    const full: EditorAids = {
      getIndex: () => buildIndex(new Map(), null),
      spellCheck: true,
      checkWords: vi.fn(async (words: string[]) => words.filter((word) => word === "teh")),
      suggest: vi.fn(async () => ["the", "tea"]),
      addWord: vi.fn(async () => undefined),
      ...aids,
    };
    const utils = render(<Editor value={value} label="LaTeX source" onChange={vi.fn()} handle={handle} aids={full} onSelectionText={onSelectionText} />);
    const view = EditorView.findFromDOM(utils.container.querySelector<HTMLElement>(".cm-content")!)!;
    return { ...utils, handle: handle.current!, view, aids: full, onSelectionText };
  }

  it("tidies indentation as one undo step", () => {
    const { handle, view } = mountAids("\\begin{itemize}\n\\item x\n\\end{itemize}");
    act(() => handle.tidy());
    expect(view.state.doc.toString()).toBe("\\begin{itemize}\n  \\item x\n\\end{itemize}");
    act(() => void undo(view));
    expect(view.state.doc.toString()).toBe("\\begin{itemize}\n\\item x\n\\end{itemize}");
  });

  it("reports the selected text", () => {
    const { handle, view, onSelectionText } = mountAids("one two three");
    act(() => view.dispatch({ selection: { anchor: 4, head: 13 } }));
    expect(handle.selectionText()).toBe("two three");
    expect(onSelectionText).toHaveBeenLastCalledWith("two three");
  });

  it("closes an environment on Enter", () => {
    const { view } = mountAids("\\begin{itemize}");
    act(() => view.dispatch({ selection: { anchor: 15 } }));
    act(() => void view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(view.state.doc.toString()).toBe("\\begin{itemize}\n  \n\\end{itemize}");
    expect(view.state.selection.main.head).toBe(18);
  });

  it("marks grammar issues and clears them", () => {
    const { handle, container } = mountAids("This are fine.");
    act(() => handle.setGrammar([{ from: 5, to: 8, message: "Use is", replacements: ["is"] }]));
    expect(container.querySelector(".cm-grammar")).toHaveTextContent("are");
    act(() => handle.setGrammar([]));
    expect(container.querySelector(".cm-grammar")).toBeNull();
  });

  it("underlines misspelled prose words only", async () => {
    const { container, aids } = mountAids("teh \\textbf{teh} $teh$ fine");
    await waitFor(() => expect(container.querySelectorAll(".cm-spell")).toHaveLength(2), { timeout: 2000 });
    expect(aids.checkWords).toHaveBeenCalledWith(["teh", "fine"]);
  });

  it("offers suggestions on right-click and replaces the word", async () => {
    const { container, view } = mountAids("teh end");
    await waitFor(() => expect(container.querySelector(".cm-spell")).not.toBeNull(), { timeout: 2000 });
    const mark = container.querySelector<HTMLElement>(".cm-spell")!;
    vi.spyOn(view, "posAtCoords").mockReturnValue(1);
    act(() => void mark.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })));
    const fix = await screen.findByRole("menuitem", { name: "the" });
    act(() => fix.click());
    expect(view.state.doc.toString()).toBe("the end");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not check spelling when it is turned off", async () => {
    const checkWords = vi.fn(async () => []);
    mountAids("teh", { spellCheck: false, checkWords });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(checkWords).not.toHaveBeenCalled();
  });
});

describe("Editor navigation (spec 007 US2)", () => {
  const aids = (vim: boolean): EditorAids => ({
    getIndex: () => buildIndex(new Map(), null),
    spellCheck: false,
    vim,
    checkWords: async () => [],
    suggest: async () => [],
    addWord: async () => undefined,
  });

  it("turns Vim keys on and off with the setting", () => {
    const { container, rerender } = render(<Editor value="abc" label="LaTeX source" onChange={vi.fn()} aids={aids(false)} />);
    expect(container.querySelector(".cm-vim-panel")).toBeNull();
    rerender(<Editor value="abc" label="LaTeX source" onChange={vi.fn()} aids={aids(true)} />);
    expect(container.querySelector(".cm-vim-panel")).not.toBeNull();
    rerender(<Editor value="abc" label="LaTeX source" onChange={vi.fn()} aids={aids(false)} />);
    expect(container.querySelector(".cm-vim-panel")).toBeNull();
  });

  it("preloads a file so an edit there is undoable once it is shown", () => {
    const handle: { current: EditorHandle | null } = { current: null };
    const { container } = render(<Editor value="main" label="LaTeX source" onChange={vi.fn()} handle={handle} />);
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-content")!)!;
    act(() => handle.current!.switchTo("main.tex", "main"));
    act(() => handle.current!.preload("b.tex", "old words"));
    expect(handle.current!.applyTo("b.tex", { from: 0, to: 9, insert: "new words", selectFrom: 0, selectTo: 0 })).toBe("new words");
    act(() => handle.current!.switchTo("b.tex", "ignored"));
    expect(view.state.doc.toString()).toBe("new words");
    act(() => void undo(view));
    expect(view.state.doc.toString()).toBe("old words");
  });

  it("selects a range for search results", () => {
    const handle: { current: EditorHandle | null } = { current: null };
    render(<Editor value="find the word" label="LaTeX source" onChange={vi.fn()} handle={handle} />);
    act(() => handle.current!.selectRange(9, 13));
    expect(handle.current!.selectionText()).toBe("word");
  });
});
