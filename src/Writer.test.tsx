import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileSource, exportPdf, loadPdf, type CompileResult } from "./compile";
import { chooseOpenPath, chooseSavePath, confirmDiscard, defaultFolder, prepareSavePath, readDocument, writeDocument } from "./documents";
import type { EditorHandle } from "./Editor";
import { BLOCK_START, XELATEX_MARKER } from "./latex/settings";
import { STARTER_DOCUMENT } from "./starter";
import { clampSplit, compileReducer, MAX_SPLIT, MIN_SPLIT, statusLabel, Writer } from "./Writer";

// A textarea that implements the same EditorHandle; CodeMirror itself is covered in Editor.test.tsx.
vi.mock("./Editor", async () => {
  const React = await import("react");
  return {
    Editor: ({ value, onChange, label, handle }: { value: string; onChange: (v: string) => void; label: string; handle?: React.Ref<EditorHandle> }) => {
      const area = React.useRef<HTMLTextAreaElement>(null);
      React.useImperativeHandle(handle, () => ({
        getText: () => area.current!.value,
        getSelection: () => ({ from: area.current!.selectionStart, to: area.current!.selectionEnd }),
        apply: (edit) => {
          const text = area.current!.value;
          onChange(text.slice(0, edit.from) + edit.insert + text.slice(edit.to));
        },
        replaceAll: (text) => {
          if (text !== area.current!.value) onChange(text);
        },
        focus: () => area.current!.focus(),
      }));
      return <textarea ref={area} className="editor" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />;
    },
  };
});
vi.mock("./PdfView", () => ({
  PdfView: ({ bytes, busy }: { bytes: Uint8Array | null; busy: boolean }) => (
    <div data-testid="pdf">{bytes ? `pdf ${Array.from(bytes).join(",")}` : busy ? "Compiling" : "No PDF yet"}</div>
  ),
}));
vi.mock("./compile", () => ({ compileSource: vi.fn(), loadPdf: vi.fn(), exportPdf: vi.fn() }));
vi.mock("./documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./documents")>()),
  chooseOpenPath: vi.fn(),
  chooseSavePath: vi.fn(),
  confirmDiscard: vi.fn(),
  defaultFolder: vi.fn(),
  prepareSavePath: vi.fn(),
  readDocument: vi.fn(),
  writeDocument: vi.fn(),
}));
vi.mock("./latex/fonts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./latex/fonts")>()),
  listSystemFonts: vi.fn(() => Promise.resolve(["Arial", "Georgia"])),
}));

type CloseEvent = { preventDefault: () => void };
let closeHandler: ((event: CloseEvent) => Promise<void>) | null = null;
const unlistenClose = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (handler: (event: CloseEvent) => Promise<void>) => {
      closeHandler = handler;
      return Promise.resolve(unlistenClose);
    },
  }),
}));

const LEXY = "C:\\Users\\me\\Documents\\Lexy";
const PATH = `${LEXY}\\thesis.tex`;
const PDF = "C:\\Users\\me\\AppData\\Local\\Lexy\\Build\\abc\\thesis.pdf";
const failed: CompileResult = {
  ok: false,
  summary: "Line 3: Undefined control sequence.",
  log: "--- LaTeX log ---\n./thesis.tex:3: Undefined control sequence.\nl.3 \\foo",
  pdfPath: null,
  engine: "pdflatex",
};
const succeeded: CompileResult = { ok: true, summary: "PDF ready", log: "Output written", pdfPath: PDF, engine: "pdflatex" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

const initial = { status: "idle", summary: null, log: "", pdfPath: null, origin: null, explicitBusy: false } as const;

describe("compileReducer", () => {
  it.each(["idle", "dirty", "ready", "error"] as const)("edit from %s → dirty", (status) => {
    expect(compileReducer({ ...initial, status }, { type: "edit" }).status).toBe("dirty");
  });

  it("keeps compiling when edited mid-compile", () => {
    const state = { ...initial, status: "compiling" as const };
    expect(compileReducer(state, { type: "edit" })).toBe(state);
  });

  it("explicit start sets explicitBusy; a second explicit start is ignored", () => {
    const started = compileReducer(initial, { type: "start", origin: "explicit" });
    expect(started).toMatchObject({ status: "compiling", explicitBusy: true });
    expect(compileReducer(started, { type: "start", origin: "explicit" })).toBe(started);
  });

  it("live start does not mark explicitBusy", () => {
    expect(compileReducer(initial, { type: "start", origin: "live" })).toMatchObject({ status: "compiling", explicitBusy: false });
  });

  it("records results with their origin", () => {
    expect(compileReducer({ ...initial, status: "compiling" }, { type: "done", origin: "live", result: failed })).toEqual({
      status: "error",
      summary: failed.summary,
      log: failed.log,
      pdfPath: null,
      origin: "live",
      explicitBusy: false,
    });
  });

  it("a live result during an explicit compile keeps showing Compiling", () => {
    const busy = compileReducer(initial, { type: "start", origin: "explicit" });
    const afterLive = compileReducer(busy, { type: "done", origin: "live", result: succeeded });
    expect(afterLive).toMatchObject({ status: "compiling", explicitBusy: true });
    expect(compileReducer(afterLive, { type: "done", origin: "explicit", result: failed })).toMatchObject({ status: "error", explicitBusy: false });
  });

  it("reset returns to the initial state", () => {
    expect(compileReducer({ ...initial, status: "error", summary: "x" }, { type: "reset" })).toEqual(initial);
  });

  it("labels live failures differently from explicit ones", () => {
    expect(statusLabel({ ...initial, status: "error", origin: "live" })).toBe("Preview failed");
    expect(statusLabel({ ...initial, status: "error", origin: "explicit" })).toBe("Compile failed");
    expect(statusLabel({ ...initial, status: "dirty" })).toBe("Changed");
  });
});

describe("clampSplit", () => {
  it.each([
    [0.5, 0.5],
    [0, MIN_SPLIT],
    [1, MAX_SPLIT],
    [Number.NaN, 0.5],
  ])("clampSplit(%s) → %s", (input, expected) => {
    expect(clampSplit(input)).toBe(expected);
  });
});

describe("Writer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeHandler = null;
    localStorage.clear();
    localStorage.setItem("lexy.livePreview", "0"); // most tests are about explicit actions
    vi.mocked(writeDocument).mockResolvedValue(undefined);
    vi.mocked(compileSource).mockResolvedValue(succeeded);
    vi.mocked(loadPdf).mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(defaultFolder).mockResolvedValue({ path: LEXY, fallback: false });
    vi.mocked(prepareSavePath).mockImplementation((picked) => Promise.resolve(picked));
    vi.mocked(exportPdf).mockResolvedValue("exported.pdf");
  });
  afterEach(() => vi.useRealTimers());

  const status = () => screen.getByRole("status");
  const compileButton = () => screen.getByRole("button", { name: "Compile" });
  const editor = () => screen.getByRole("textbox", { name: "LaTeX source" }) as HTMLTextAreaElement;
  const drawer = () => screen.queryByRole("region", { name: "Compile log" });
  const preview = () => screen.getByRole("region", { name: "PDF preview" });
  const unsavedDot = () => screen.queryByRole("img", { name: "Unsaved changes" });
  const tab = (name: string) => screen.getByRole("tab", { name });

  function select(from: number, to = from) {
    editor().focus();
    editor().setSelectionRange(from, to);
  }

  async function savedWriter() {
    const user = userEvent.setup();
    vi.mocked(chooseSavePath).mockResolvedValueOnce(PATH);
    render(<Writer />);
    await user.click(tab("File"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    return user;
  }

  describe("first launch", () => {
    it("shows the ribbon, the starter article, Untitled.tex, idle status and a blank preview", () => {
      render(<Writer />);
      expect(screen.getByRole("tablist", { name: "Ribbon" })).toBeInTheDocument();
      expect(editor()).toHaveValue(STARTER_DOCUMENT);
      expect(screen.getByText("Untitled.tex")).toBeInTheDocument();
      expect(unsavedDot()).not.toBeInTheDocument();
      expect(status()).toHaveTextContent("Idle");
      expect(preview()).toHaveTextContent("No PDF yet");
      expect(drawer()).not.toBeInTheDocument();
      expect(compileSource).not.toHaveBeenCalled();
    });

    it("compiles the starter right away when live preview is on", async () => {
      localStorage.setItem("lexy.livePreview", "1");
      render(<Writer />);
      await waitFor(() => expect(preview()).toHaveTextContent("pdf 1,2,3"));
      expect(compileSource).toHaveBeenCalledWith(STARTER_DOCUMENT, null);
      expect(writeDocument).not.toHaveBeenCalled();
    });
  });

  describe("saving to Documents\\Lexy", () => {
    it("starts an untitled save in the default folder, then writes and shows the name", async () => {
      await savedWriter();
      expect(defaultFolder).toHaveBeenCalled();
      expect(chooseSavePath).toHaveBeenCalledWith(null, LEXY, "Untitled.tex");
      expect(writeDocument).toHaveBeenCalledWith(PATH, STARTER_DOCUMENT);
      expect(screen.getByText("thesis.tex").parentElement).toHaveAttribute("title", PATH);
    });

    it("saves a named document in place without a dialog", async () => {
      const user = await savedWriter();
      await user.type(editor(), "!");
      expect(unsavedDot()).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(chooseSavePath).toHaveBeenCalledTimes(1);
      expect(writeDocument).toHaveBeenLastCalledWith(PATH, `${STARTER_DOCUMENT}!`);
      expect(unsavedDot()).not.toBeInTheDocument();
    });

    it("Save as starts from the current path, not the default folder", async () => {
      const user = await savedWriter();
      vi.mocked(chooseSavePath).mockResolvedValueOnce(`${LEXY}\\copy.tex`);
      await user.click(screen.getByRole("button", { name: "Save as" }));
      expect(chooseSavePath).toHaveBeenLastCalledWith(PATH, null, "Untitled.tex");
      expect(screen.getByText("copy.tex")).toBeInTheDocument();
    });

    it("shows a one-time notice when Lexy falls back to the home folder", async () => {
      vi.mocked(defaultFolder).mockResolvedValue({ path: "C:\\Users\\me", fallback: true });
      vi.mocked(chooseSavePath).mockResolvedValue(null);
      const user = userEvent.setup();
      render(<Writer />);
      await user.click(tab("File"));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Saving to C:\\Users\\me because Documents isn't available.");
      expect(chooseSavePath).toHaveBeenCalledWith(null, "C:\\Users\\me", "Untitled.tex");
      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("still saves when the default folder can't be resolved", async () => {
      vi.mocked(defaultFolder).mockRejectedValueOnce("no folder");
      vi.mocked(chooseSavePath).mockResolvedValueOnce(PATH);
      const user = userEvent.setup();
      render(<Writer />);
      await user.click(tab("File"));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(chooseSavePath).toHaveBeenCalledWith(null, null, "Untitled.tex");
      expect(writeDocument).toHaveBeenCalled();
    });

    it("keeps unsaved state and shows an alert when writing fails", async () => {
      vi.mocked(chooseSavePath).mockResolvedValueOnce(PATH);
      vi.mocked(writeDocument).mockRejectedValueOnce("Access is denied.");
      const user = userEvent.setup();
      render(<Writer />);
      await user.type(editor(), "x");
      await user.click(tab("File"));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Could not save the file. Access is denied.");
      expect(unsavedDot()).toBeInTheDocument();
    });
  });

  describe("opening and new", () => {
    it("opens from the default folder into the editor and resets status", async () => {
      vi.mocked(chooseOpenPath).mockResolvedValueOnce("C:\\docs\\paper.tex");
      vi.mocked(readDocument).mockResolvedValueOnce("\\documentclass{book}");
      const user = userEvent.setup();
      render(<Writer />);
      await user.click(tab("File"));
      await user.click(screen.getByRole("button", { name: "Open" }));
      expect(chooseOpenPath).toHaveBeenCalledWith(LEXY);
      expect(editor()).toHaveValue("\\documentclass{book}");
      expect(screen.getByText("paper.tex")).toBeInTheDocument();
      expect(status()).toHaveTextContent("Idle");
    });

    it("live-compiles the opened document", async () => {
      localStorage.setItem("lexy.livePreview", "1");
      vi.mocked(chooseOpenPath).mockResolvedValueOnce("C:\\docs\\paper.tex");
      vi.mocked(readDocument).mockResolvedValueOnce("\\documentclass{book}");
      const user = userEvent.setup();
      render(<Writer />);
      await user.click(tab("File"));
      await user.click(screen.getByRole("button", { name: "Open" }));
      await waitFor(() => expect(compileSource).toHaveBeenLastCalledWith("\\documentclass{book}", "C:\\docs\\paper.tex"));
    });

    it("keeps unsaved work when the user declines to discard it", async () => {
      vi.mocked(confirmDiscard).mockResolvedValueOnce(false);
      const user = userEvent.setup();
      render(<Writer />);
      await user.type(editor(), "keep me");
      await user.click(tab("File"));
      await user.click(screen.getByRole("button", { name: "Open" }));
      expect(chooseOpenPath).not.toHaveBeenCalled();
      expect(editor().value).toContain("keep me");
    });

    it("shows an alert when a file can't be read", async () => {
      vi.mocked(chooseOpenPath).mockResolvedValueOnce("C:\\docs\\latin1.tex");
      vi.mocked(readDocument).mockRejectedValueOnce("stream did not contain valid UTF-8");
      const user = userEvent.setup();
      render(<Writer />);
      await user.click(tab("File"));
      await user.click(screen.getByRole("button", { name: "Open" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Could not open the file.");
      expect(editor()).toHaveValue(STARTER_DOCUMENT);
    });

    it("New discards changes after confirmation", async () => {
      const user = await savedWriter();
      vi.mocked(confirmDiscard).mockResolvedValueOnce(true);
      await user.type(editor(), "draft");
      await user.click(screen.getByRole("button", { name: "New" }));
      expect(editor()).toHaveValue(STARTER_DOCUMENT);
      expect(screen.getByText("Untitled.tex")).toBeInTheDocument();
    });
  });

  describe("explicit compile (F5 / Compile)", () => {
    it("saves first, compiles the saved text and shows the PDF", async () => {
      vi.mocked(chooseSavePath).mockResolvedValueOnce(PATH);
      const user = userEvent.setup();
      render(<Writer />);
      await user.type(editor(), "!");
      await user.click(compileButton());
      expect(writeDocument).toHaveBeenCalledWith(PATH, `${STARTER_DOCUMENT}!`);
      expect(compileSource).toHaveBeenCalledWith(`${STARTER_DOCUMENT}!`, PATH);
      expect(loadPdf).toHaveBeenCalledWith(PDF);
      expect(status()).toHaveTextContent("PDF ready");
      expect(preview()).toHaveTextContent("pdf 1,2,3");
      expect(drawer()).not.toBeInTheDocument();
    });

    it("does not compile if the save dialog is cancelled", async () => {
      vi.mocked(chooseSavePath).mockResolvedValueOnce(null);
      const user = userEvent.setup();
      render(<Writer />);
      await user.click(compileButton());
      expect(compileSource).not.toHaveBeenCalled();
    });

    it("disables Compile while running and ignores F5 meanwhile", async () => {
      const user = await savedWriter();
      const run = deferred<CompileResult>();
      vi.mocked(compileSource).mockReturnValueOnce(run.promise);
      await user.click(compileButton());
      expect(status()).toHaveTextContent("Compiling");
      expect(screen.getByRole("button", { name: "Compiling" })).toBeDisabled();
      await user.keyboard("{F5}");
      expect(compileSource).toHaveBeenCalledTimes(1);
      await act(async () => run.resolve(succeeded));
      expect(compileButton()).toBeEnabled();
    });

    it("opens the log with the first error and shows the preview banner on failure", async () => {
      const user = await savedWriter();
      vi.mocked(compileSource).mockResolvedValueOnce(failed);
      await user.click(compileButton());
      expect(status()).toHaveTextContent("Compile failed");
      expect(drawer()).toHaveTextContent(failed.summary);
      expect(drawer()!.querySelector("pre")).toHaveTextContent("l.3 \\foo");
      expect(preview()).toHaveTextContent("Compile failed. Open log.");
    });

    it("treats a backend error or an unreadable PDF as a failure", async () => {
      const user = await savedWriter();
      vi.mocked(compileSource).mockRejectedValueOnce("compile task failed");
      await user.click(compileButton());
      expect(drawer()).toHaveTextContent("compile task failed");
      vi.mocked(loadPdf).mockRejectedValueOnce("is not a Lexy build output");
      await user.click(compileButton());
      expect(status()).toHaveTextContent("Compile failed");
      expect(drawer()).toHaveTextContent("is not a Lexy build output");
    });

    it("copies the full raw log", async () => {
      const user = await savedWriter();
      vi.mocked(compileSource).mockResolvedValueOnce(failed);
      await user.click(compileButton());
      await user.click(screen.getByRole("button", { name: "Copy log" }));
      expect(await navigator.clipboard.readText()).toBe(failed.log);
    });
  });

  describe("live preview", () => {
    beforeEach(() => {
      localStorage.setItem("lexy.livePreview", "1");
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    async function liveWriter() {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<Writer />);
      await waitFor(() => expect(compileSource).toHaveBeenCalledTimes(1));
      await act(async () => {});
      vi.mocked(compileSource).mockClear();
      return user;
    }

    it("compiles the unsaved text about 1 s after typing stops, without saving", async () => {
      const user = await liveWriter();
      await user.type(editor(), "abc");
      expect(compileSource).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(compileSource).toHaveBeenCalledTimes(1);
      expect(compileSource).toHaveBeenCalledWith(`${STARTER_DOCUMENT}abc`, null);
      expect(writeDocument).not.toHaveBeenCalled();
      expect(unsavedDot()).toBeInTheDocument();
    });

    it("shows live failures in the status and banner without opening the log", async () => {
      const user = await liveWriter();
      vi.mocked(compileSource).mockResolvedValueOnce(failed);
      await user.type(editor(), "\\foo");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(status()).toHaveTextContent("Preview failed");
      expect(status()).toHaveAttribute("title", failed.summary);
      expect(preview()).toHaveTextContent(`Preview failed: ${failed.summary}`);
      expect(drawer()).not.toBeInTheDocument();
    });

    it("keeps the last good PDF after a failed live compile", async () => {
      const user = await liveWriter();
      expect(preview()).toHaveTextContent("pdf 1,2,3");
      vi.mocked(compileSource).mockResolvedValueOnce(failed);
      await user.type(editor(), "x");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(preview()).toHaveTextContent("pdf 1,2,3");
    });

    it("View → Live preview turns it off and remembers that", async () => {
      const user = await liveWriter();
      await user.click(tab("View"));
      await user.click(screen.getByRole("button", { name: "Live preview" }));
      expect(screen.getByRole("button", { name: "Live preview" })).toHaveAttribute("aria-pressed", "false");
      expect(localStorage.getItem("lexy.livePreview")).toBe("0");
      await user.type(editor(), "abc");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(compileSource).not.toHaveBeenCalled();
    });

    it("uses the saved path once the document has one", async () => {
      vi.mocked(chooseSavePath).mockResolvedValueOnce(PATH);
      const user = await liveWriter();
      await user.click(tab("File"));
      await user.click(screen.getByRole("button", { name: "Save" }));
      await user.type(editor(), "z");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(compileSource).toHaveBeenLastCalledWith(`${STARTER_DOCUMENT}z`, PATH);
    });
  });

  describe("Home and Insert actions", () => {
    it("Bold wraps the selection", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      const start = STARTER_DOCUMENT.indexOf("Start writing");
      select(start, start + 5);
      await user.click(screen.getByRole("button", { name: "Bold" }));
      expect(editor().value).toContain("\\textbf{Start} writing here.");
    });

    it("Ctrl+B / Ctrl+I / Ctrl+U format inside the editor only", () => {
      render(<Writer />);
      const start = STARTER_DOCUMENT.indexOf("writing");
      select(start, start + 7);
      fireEvent.keyDown(editor(), { key: "i", ctrlKey: true });
      expect(editor().value).toContain("\\textit{writing}");
      const before = editor().value;
      fireEvent.keyDown(screen.getByRole("tab", { name: "Home" }), { key: "b", ctrlKey: true });
      expect(editor().value).toBe(before);
    });

    it("Styles → Heading 1 turns the current line into a section", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      select(STARTER_DOCUMENT.indexOf("Start writing") + 2);
      await user.click(screen.getByRole("button", { name: "Styles" }));
      await user.click(screen.getByRole("menuitem", { name: /Heading 1/ }));
      expect(editor().value).toContain("\\section{Start writing here.}");
    });

    it("Bullets turns the current line into a list", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      select(STARTER_DOCUMENT.indexOf("Start writing"));
      await user.click(screen.getByRole("button", { name: "Bullets" }));
      expect(editor().value).toContain("\\begin{itemize}\n  \\item Start writing here.\n\\end{itemize}");
    });

    it("Insert → Page break and Footnote", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      await user.click(tab("Insert"));
      select(STARTER_DOCUMENT.indexOf("\\end{document}"));
      await user.click(screen.getByRole("button", { name: "Page break" }));
      expect(editor().value).toContain("\\newpage\n\\end{document}");
      select(STARTER_DOCUMENT.indexOf("here.") + 5);
      await user.click(screen.getByRole("button", { name: "Footnote" }));
      expect(editor().value).toContain("here.\\footnote{}");
    });

    it("Insert → Table inserts a tabular on its own lines", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      await user.click(tab("Insert"));
      select(STARTER_DOCUMENT.indexOf("\\end{document}"));
      await user.click(screen.getByRole("button", { name: "Table" }));
      await user.click(screen.getByRole("gridcell", { name: "3 x 2" }));
      expect(editor().value).toContain("\\begin{tabular}{|l|l|l|}");
      expect(editor().value).toContain("\\end{tabular}\n\\end{document}");
    });

    it("Insert → Equation inserts a display equation", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      await user.click(tab("Insert"));
      select(STARTER_DOCUMENT.indexOf("\\end{document}"));
      await user.click(screen.getByRole("button", { name: "Equation" }));
      const field = await screen.findByLabelText("LaTeX math");
      await user.type(field, "E=mc^2");
      await user.click(screen.getByRole("button", { name: "Insert" }));
      expect(editor().value).toContain("\\begin{equation}\n  E=mc^2\n\\end{equation}\n\\end{document}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("Insert → Equation edits the equation under the cursor in place", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      await user.clear(editor());
      await user.type(editor(), "a \\(x^2\\) b");
      select(5);
      await user.click(tab("Insert"));
      await user.click(screen.getByRole("button", { name: "Equation" }));
      const field = await screen.findByLabelText("LaTeX math");
      expect(field).toHaveValue("x^2");
      await user.clear(field);
      await user.type(field, "y^3");
      await user.click(screen.getByRole("button", { name: "Update" }));
      expect(editor().value).toBe("a \\(y^3\\) b");
    });
  });

  describe("fonts and layout", () => {
    it("picking Palatino writes Lexy's settings block after \\documentclass", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      await user.click(screen.getByRole("combobox", { name: "Font" }));
      await user.click(screen.getByRole("option", { name: "Palatino" }));
      expect(editor().value).toContain(`\\documentclass[10pt]{article}\n${BLOCK_START}`);
      expect(editor().value).toContain("\\usepackage{newpxtext,newpxmath}");
      expect(screen.getByRole("combobox", { name: "Font" })).toHaveValue("Palatino");
    });

    it("an installed font switches to XeLaTeX; a built-in one switches back", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      await user.click(screen.getByRole("combobox", { name: "Font" }));
      await user.click(await screen.findByRole("option", { name: "Georgia" }));
      expect(editor().value.startsWith(`${XELATEX_MARKER}\n`)).toBe(true);
      expect(editor().value).toContain("\\setmainfont{Georgia}");
      await user.click(screen.getByRole("combobox", { name: "Font" }));
      await user.click(screen.getByRole("option", { name: "Times" }));
      expect(editor().value).not.toContain(XELATEX_MARKER);
      expect(editor().value).not.toContain("fontspec");
    });

    it("size and margins change the document", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      await user.selectOptions(screen.getByRole("combobox", { name: "Font size" }), "12");
      expect(editor().value).toContain("\\documentclass[12pt]{article}");
      await user.click(tab("Layout"));
      await user.click(screen.getByRole("button", { name: "Margins" }));
      await user.click(screen.getByRole("menuitemradio", { name: /Narrow/ }));
      expect(editor().value).toContain("top=1.27cm,bottom=1.27cm,left=1.27cm,right=1.27cm");
    });

    it("warns once when the document already sets margins itself", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      await user.clear(editor());
      fireEvent.change(editor(), { target: { value: "\\documentclass{article}\n\\usepackage[margin=1in]{geometry}\n\\begin{document}x\\end{document}" } });
      await user.click(tab("Layout"));
      await user.click(screen.getByRole("button", { name: "Margins" }));
      await user.click(screen.getByRole("menuitemradio", { name: /Wide/ }));
      expect(screen.getByRole("alert")).toHaveTextContent("already sets fonts or margins itself (\\usepackage[margin=1in]{geometry})");
      expect(editor().value).toContain("\\usepackage[margin=1in]{geometry}");
      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      await user.click(screen.getByRole("button", { name: "Margins" }));
      await user.click(screen.getByRole("menuitemradio", { name: /Narrow/ }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("explains when there is no \\documentclass to attach settings to", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      fireEvent.change(editor(), { target: { value: "just text" } });
      await user.selectOptions(screen.getByRole("combobox", { name: "Font size" }), "11");
      expect(screen.getByRole("alert")).toHaveTextContent("Add a \\documentclass line first.");
      expect(editor()).toHaveValue("just text");
    });
  });

  describe("keyboard shortcuts", () => {
    it("Ctrl+S, Ctrl+Shift+S, Ctrl+O, Ctrl+N, F5 and Ctrl+L", async () => {
      const user = await savedWriter();
      await user.keyboard("{Control>}s{/Control}");
      expect(writeDocument).toHaveBeenCalledTimes(2);
      vi.mocked(chooseSavePath).mockResolvedValueOnce(null);
      await user.keyboard("{Control>}{Shift>}S{/Shift}{/Control}");
      expect(chooseSavePath).toHaveBeenCalledTimes(2);
      vi.mocked(chooseOpenPath).mockResolvedValueOnce(null);
      await user.keyboard("{Control>}o{/Control}");
      expect(chooseOpenPath).toHaveBeenCalled();
      await user.keyboard("{F5}");
      expect(compileSource).toHaveBeenCalledWith(STARTER_DOCUMENT, PATH);
      await user.keyboard("{Control>}l{/Control}");
      expect(drawer()).toBeInTheDocument();
      await user.keyboard("{Control>}n{/Control}");
      expect(screen.getByText("Untitled.tex")).toBeInTheDocument();
    });

    it("handles shortcuts before the editor sees them", () => {
      render(<Writer />);
      const inner = vi.fn();
      editor().addEventListener("keydown", inner);
      expect(fireEvent.keyDown(editor(), { key: "l", ctrlKey: true })).toBe(false);
      expect(inner).not.toHaveBeenCalled();
      expect(fireEvent.keyDown(editor(), { key: "q", ctrlKey: true })).toBe(true);
      expect(inner).toHaveBeenCalled();
    });
  });

  describe("closing the window", () => {
    it("asks before closing with unsaved changes and cancels if declined", async () => {
      vi.mocked(confirmDiscard).mockResolvedValueOnce(false);
      const user = userEvent.setup();
      render(<Writer />);
      await user.type(editor(), "x");
      const event = { preventDefault: vi.fn() };
      await closeHandler!(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("closes without asking when saved, and unsubscribes on unmount", async () => {
      const { unmount } = render(<Writer />);
      const event = { preventDefault: vi.fn() };
      await closeHandler!(event);
      expect(confirmDiscard).not.toHaveBeenCalled();
      await act(async () => {});
      unmount();
      expect(unlistenClose).toHaveBeenCalled();
    });
  });

  describe("PDF saved next to the document on exit", () => {
    async function close() {
      const event = { preventDefault: vi.fn() };
      await act(async () => {
        await closeHandler!(event);
      });
      return event;
    }

    it("copies the PDF that matches the saved text, without compiling again", async () => {
      const user = await savedWriter();
      await user.click(compileButton());
      vi.mocked(compileSource).mockClear();
      const event = await close();
      expect(compileSource).not.toHaveBeenCalled();
      expect(exportPdf).toHaveBeenCalledWith(PDF, PATH);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("compiles the saved text first when the last preview doesn't match what's saved", async () => {
      // Live preview renders the untitled draft; then the user saves and keeps typing.
      localStorage.setItem("lexy.livePreview", "1");
      const user = userEvent.setup();
      render(<Writer />);
      await waitFor(() => expect(compileSource).toHaveBeenCalledWith(STARTER_DOCUMENT, null));
      vi.mocked(chooseSavePath).mockResolvedValueOnce(PATH);
      await user.click(tab("File"));
      await user.click(screen.getByRole("button", { name: "Save" }));
      await user.type(editor(), "unsaved draft");
      vi.mocked(confirmDiscard).mockResolvedValueOnce(true);
      vi.mocked(compileSource).mockClear();
      vi.mocked(compileSource).mockResolvedValueOnce({ ...succeeded, pdfPath: "C:\\build\\saved.pdf" });
      await close();
      expect(compileSource).toHaveBeenCalledWith(STARTER_DOCUMENT, PATH);
      expect(exportPdf).toHaveBeenCalledWith("C:\\build\\saved.pdf", PATH);
    });

    it("exports nothing for an untitled document", async () => {
      render(<Writer />);
      const event = await close();
      expect(exportPdf).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("stays open once with a notice when the PDF can't be written, then lets you quit", async () => {
      await savedWriter();
      vi.mocked(exportPdf).mockRejectedValue("failed to save Thesis.pdf: Access is denied. (is the PDF open in another program?)");
      const first = await close();
      expect(first.preventDefault).toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent("couldn't save the PDF next to your document");
      expect(screen.getByRole("alert")).toHaveTextContent("Close again to quit without it.");
      const second = await close();
      expect(second.preventDefault).not.toHaveBeenCalled();
    });

    it("explains when the saved document doesn't compile", async () => {
      await savedWriter();
      vi.mocked(compileSource).mockResolvedValueOnce(failed);
      const event = await close();
      expect(event.preventDefault).toHaveBeenCalled();
      expect(exportPdf).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent("doesn't compile (Line 3: Undefined control sequence.)");
    });
  });

  describe("project folders and names", () => {
    it("suggests a file name from \\title and saves into the project folder Lexy picks", async () => {
      vi.mocked(chooseSavePath).mockResolvedValueOnce(`${LEXY}\\My Paper.tex`);
      vi.mocked(prepareSavePath).mockResolvedValueOnce(`${LEXY}\\My Paper\\My Paper.tex`);
      const user = userEvent.setup();
      render(<Writer />);
      fireEvent.change(editor(), { target: { value: STARTER_DOCUMENT.replace("\\title{Untitled}", "\\title{My Paper: A \\LaTeX{} Study}") } });
      await user.click(tab("File"));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(chooseSavePath).toHaveBeenCalledWith(null, LEXY, "My Paper A Study.tex");
      expect(prepareSavePath).toHaveBeenCalledWith(`${LEXY}\\My Paper.tex`);
      expect(writeDocument).toHaveBeenCalledWith(`${LEXY}\\My Paper\\My Paper.tex`, expect.any(String));
      expect(screen.getByText("My Paper.tex").parentElement).toHaveAttribute("title", `${LEXY}\\My Paper\\My Paper.tex`);
    });

    it("saving an already named document doesn't move it", async () => {
      const user = await savedWriter();
      vi.mocked(prepareSavePath).mockClear();
      await user.type(editor(), "!");
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(prepareSavePath).not.toHaveBeenCalled();
      expect(writeDocument).toHaveBeenLastCalledWith(PATH, expect.any(String));
    });
  });

  describe("resizable split", () => {
    const separator = () => screen.getByRole("separator", { name: "Resize editor and preview" });

    it("moves with arrow keys, clamps and remembers", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      separator().focus();
      await user.keyboard("{ArrowRight}");
      expect(separator()).toHaveAttribute("aria-valuenow", "55");
      expect(localStorage.getItem("lexy.split")).toBe("0.55");
      for (let i = 0; i < 10; i++) await user.keyboard("{ArrowLeft}");
      expect(separator()).toHaveAttribute("aria-valuenow", "20");
    });

    it("follows the pointer while dragging and resets on double-click", async () => {
      const user = userEvent.setup();
      render(<Writer />);
      (separator().parentElement as HTMLElement).getBoundingClientRect = () => ({ left: 100, width: 800 }) as DOMRect;
      fireEvent.pointerDown(separator(), { pointerId: 1 });
      fireEvent.pointerMove(separator(), { clientX: 100 + 800 * 0.3 });
      fireEvent.pointerUp(separator());
      expect(separator()).toHaveAttribute("aria-valuenow", "30");
      await user.dblClick(separator());
      expect(separator()).toHaveAttribute("aria-valuenow", "50");
    });
  });

  it("log drawer toggles from the View tab", async () => {
    const user = userEvent.setup();
    render(<Writer />);
    await user.click(tab("View"));
    await user.click(screen.getByRole("button", { name: "Show logs" }));
    expect(within(drawer()!).getByText("No compile yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide logs" }));
    expect(drawer()).not.toBeInTheDocument();
  });
});
