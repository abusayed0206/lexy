import { act, render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { describe, expect, it, vi } from "vitest";
import { Editor, type EditorHandle } from "./Editor";

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
  });

  it("cleans up the editor on unmount", () => {
    const { view, unmount } = mount("x");
    const destroy = vi.spyOn(view, "destroy");
    unmount();
    expect(destroy).toHaveBeenCalled();
  });
});
