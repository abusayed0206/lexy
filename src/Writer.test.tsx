import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportPdf, installBanglaFont, loadPdf, syncToPdf, syncToSource, type CompileResult } from "./compile";
import type { EditorHandle } from "./Editor";
import { BLOCK_START, XELATEX_MARKER } from "./latex/settings";
import { chooseProjectFolder } from "./ProjectDialogs";
import {
  compileProject,
  createFile,
  deleteEntry,
  importFiles,
  listDir,
  listProjects,
  openEntryExternal,
  readFile,
  renameEntry,
  setMainDocument,
  writeFile,
  type Entry,
  type OpenedProject,
} from "./projects";
import { STARTER_DOCUMENT } from "./starter";
import { clampSidebar, clampSplit, compileReducer, MAX_SPLIT, MIN_SPLIT, statusDetail, statusLabel, Writer } from "./Writer";

// A textarea that implements the same EditorHandle; CodeMirror itself is covered in Editor.test.tsx.
const spies = vi.hoisted(() => ({ jumpToLine: vi.fn(), setProblems: vi.fn(), showSpot: vi.fn() }));
vi.mock("./Editor", async () => {
  const React = await import("react");
  return {
    Editor: ({ value, onChange, label, handle }: { value: string; onChange: (v: string) => void; label: string; handle?: React.Ref<EditorHandle> }) => {
      const area = React.useRef<HTMLTextAreaElement>(null);
      const current = React.useRef<string | null>(null);
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
        switchTo: (path) => {
          current.current = path;
        },
        textOf: () => null,
        applyTo: () => null,
        forget: () => undefined,
        rename: () => undefined,
        jumpToLine: (line: number) => spies.jumpToLine(current.current, line),
        cursorLine: () => 7,
        setProblems: (path: string, problems: unknown[]) => spies.setProblems(path, problems),
      }));
      return <textarea ref={area} className="editor" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />;
    },
  };
});
vi.mock("./PdfView", async () => {
  const React = await import("react");
  return {
    PdfView: ({
      bytes,
      busy,
      handle,
      onDoubleClickPoint,
    }: {
      bytes: Uint8Array | null;
      busy: boolean;
      handle?: React.Ref<unknown>;
      onDoubleClickPoint?: (page: number, x: number, y: number) => void;
    }) => {
      React.useImperativeHandle(handle, () => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), fit: vi.fn(), showSpot: spies.showSpot }));
      return (
        <div data-testid="pdf" onDoubleClick={() => onDoubleClickPoint?.(2, 10, 20)}>
          {bytes ? `pdf ${Array.from(bytes).join(",")}` : busy ? "Compiling" : "No PDF yet"}
        </div>
      );
    },
  };
});
vi.mock("./compile", () => ({ loadPdf: vi.fn(), exportPdf: vi.fn(), syncToSource: vi.fn(), syncToPdf: vi.fn(), installBanglaFont: vi.fn() }));
vi.mock("./projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./projects")>()),
  compileProject: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDir: vi.fn(),
  listProjects: vi.fn(),
  createFile: vi.fn(),
  createFolder: vi.fn(),
  createProject: vi.fn(),
  renameEntry: vi.fn(),
  deleteEntry: vi.fn(),
  importFiles: vi.fn(),
  openEntryExternal: vi.fn(),
  setMainDocument: vi.fn(),
}));
vi.mock("./ProjectDialogs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ProjectDialogs")>()),
  chooseProjectFolder: vi.fn(),
}));
vi.mock("./latex/fonts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./latex/fonts")>()),
  listSystemFonts: vi.fn(() => Promise.resolve(["Arial", "Georgia"])),
  listKritiFonts: vi.fn(() => Promise.resolve([{ family: "Kalpurush", designer: "", license: "OFL", styles: ["Regular"] }])),
  installKritiFont: vi.fn(() => Promise.resolve({ family: "Kalpurush", regular: "Kalpurush.ttf", bold: null, italic: null, boldItalic: null })),
}));
type DropHandler = (event: { payload: { type: string; paths?: string[]; position?: { x: number; y: number } } }) => void;
let dropHandler: DropHandler | null = null;
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: DropHandler) => {
      dropHandler = handler;
      return Promise.resolve(() => (dropHandler = null));
    },
  }),
}));

const events = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("./git", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./git")>()),
  gitStatus: vi.fn(() =>
    Promise.resolve({
      installed: true,
      repo: "own",
      repoRoot: null,
      branch: "main",
      remoteUrl: null,
      ahead: 0,
      behind: 0,
      changes: [{ path: "thesis.tex", oldPath: null, status: "modified", size: 1 }],
      merging: false,
      readOnly: false,
    }),
  ),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: { payload: unknown }) => void) => {
    events.set(name, handler);
    return Promise.resolve(() => events.delete(name));
  }),
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

const ROOT = "C:\\Users\\me\\Documents\\Lexy\\Thesis";
const MAIN = "thesis.tex";
const INTRO = "chapters\\intro.tex";
const PDF = "C:\\Users\\me\\AppData\\Local\\Lexy\\Build\\abc\\thesis.pdf";
const PROJECT: OpenedProject = { root: ROOT, name: "Thesis", readOnly: false, mainDocument: MAIN, candidates: [MAIN] };
const failed: CompileResult = {
  ok: false,
  summary: "Line 3: Undefined control sequence.",
  log: "--- LaTeX log ---\n./thesis.tex:3: Undefined control sequence.\nl.3 \\foo",
  pdfPath: null,
  engine: "pdflatex",
};
const succeeded: CompileResult = { ok: true, summary: "PDF ready", log: "Output written", pdfPath: PDF, engine: "pdflatex" };

const entry = (path: string, kind: "file" | "folder" = "file"): Entry => ({
  path,
  name: path.slice(path.lastIndexOf("\\") + 1),
  kind,
  editable: /\.(tex|bib)$/.test(path),
  hidden: false,
  modified: 0,
});

let disk: Record<string, string>;
let tree: Record<string, Entry[]>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

const initial = { status: "idle", summary: null, log: "", pdfPath: null, origin: null, explicitBusy: false, engine: null } as const;

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

  it("a live result during an explicit compile keeps showing Compiling", () => {
    const busy = compileReducer(initial, { type: "start", origin: "explicit" });
    const afterLive = compileReducer(busy, { type: "done", origin: "live", result: succeeded });
    expect(afterLive).toMatchObject({ status: "compiling", explicitBusy: true });
    expect(compileReducer(afterLive, { type: "done", origin: "explicit", result: failed })).toMatchObject({ status: "error", explicitBusy: false });
  });

  it("labels live failures differently from explicit ones", () => {
    expect(statusLabel({ ...initial, status: "error", origin: "live" })).toBe("Preview failed");
    expect(statusLabel({ ...initial, status: "error", origin: "explicit" })).toBe("Compile failed");
    expect(statusLabel({ ...initial, status: "dirty" })).toBe("Changed");
  });

  it("remembers the engine of the last result and shows it in the status tooltip", () => {
    const done = compileReducer(initial, { type: "done", origin: "explicit", result: { ...succeeded, engine: "xelatex" } });
    expect(done.engine).toBe("xelatex");
    expect(statusDetail(done)).toBe("XeLaTeX · PDF ready");
    const broken = compileReducer(done, { type: "done", origin: "live", result: failed });
    expect(statusDetail(broken)).toBe(`pdfLaTeX · ${failed.summary}`);
    expect(statusDetail(initial)).toBeNull();
    expect(statusDetail({ ...initial, status: "error", summary: "boom" })).toBe("boom");
  });
});

describe("clamps", () => {
  it.each([
    [0.5, 0.5],
    [0, MIN_SPLIT],
    [1, MAX_SPLIT],
    [Number.NaN, 0.5],
  ])("clampSplit(%s) → %s", (input, expected) => {
    expect(clampSplit(input)).toBe(expected);
  });

  it.each([
    [220, 220],
    [10, 160],
    [900, 400],
    [Number.NaN, 220],
  ])("clampSidebar(%s) → %s", (input, expected) => {
    expect(clampSidebar(input)).toBe(expected);
  });
});

describe("Writer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events.clear();
    closeHandler = null;
    localStorage.clear();
    localStorage.setItem("lexy.livePreview", "0"); // most tests are about explicit actions
    localStorage.setItem("lexy.filesOpen", "1");
    disk = { [MAIN]: STARTER_DOCUMENT, [INTRO]: "Intro text." };
    tree = {
      "": [entry("chapters", "folder"), entry("fig.png"), entry(MAIN)],
      chapters: [entry(INTRO)],
    };
    vi.mocked(readFile).mockImplementation((rel) => (rel in disk ? Promise.resolve(disk[rel]) : Promise.reject({ kind: "notFound", message: `${rel} does not exist` })));
    vi.mocked(writeFile).mockImplementation((rel, text) => {
      disk[rel] = text;
      return Promise.resolve();
    });
    vi.mocked(listDir).mockImplementation((rel) => Promise.resolve(tree[rel] ?? []));
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(compileProject).mockResolvedValue(succeeded);
    vi.mocked(loadPdf).mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(exportPdf).mockResolvedValue("exported.pdf");
  });
  afterEach(() => vi.useRealTimers());

  const compileStatus = () => document.querySelector(".compile-status") as HTMLElement;
  const compileButton = () => screen.getByRole("button", { name: "Compile" });
  const editor = () => screen.getByRole("textbox", { name: "LaTeX source" }) as HTMLTextAreaElement;
  const drawer = () => screen.queryByRole("region", { name: "Compile log" });
  const preview = () => screen.getByRole("region", { name: "PDF preview" });
  const tab = (name: string) => screen.getByRole("tab", { name });
  const title = () => document.querySelector(".doc-title") as HTMLElement;
  const unsavedInTitle = () => within(title()).queryByRole("img", { name: "Unsaved changes" });
  const row = (name: string) => screen.getByRole("treeitem", { name });

  function select(from: number, to = from) {
    editor().focus();
    editor().setSelectionRange(from, to);
  }

  async function renderWriter(project: OpenedProject = PROJECT) {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    const utils = render(<Writer project={project} onSwitch={onSwitch} />);
    if (project.mainDocument) await waitFor(() => expect(editor()).toHaveValue(disk[project.mainDocument!]));
    return { user, onSwitch, ...utils };
  }

  /** Open chapters\intro.tex from the sidebar. */
  async function openIntro(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("treeitem", { name: "chapters" }));
    await user.click(await screen.findByRole("treeitem", { name: "intro.tex" }));
    await waitFor(() => expect(editor()).toHaveValue("Intro text."));
  }

  function type(text: string) {
    fireEvent.change(editor(), { target: { value: editor().value + text } });
  }

  describe("opening a project", () => {
    it("shows the main document, project name, Main badge, the file sidebar and an idle preview", async () => {
      await renderWriter();
      expect(within(title()).getByText("Thesis")).toBeInTheDocument();
      expect(within(title()).getByText(MAIN)).toBeInTheDocument();
      expect(within(title()).getByText("Main")).toBeInTheDocument();
      expect(title()).toHaveAttribute("title", `${ROOT}\\${MAIN} · Main: ${MAIN}`);
      expect(await screen.findByRole("treeitem", { name: MAIN })).toHaveAttribute("aria-selected", "true");
      expect(compileStatus()).toHaveTextContent("Idle");
      expect(preview()).toHaveTextContent("No PDF yet");
      expect(compileProject).not.toHaveBeenCalled();
    });

    it("compiles the main document right away when live preview is on", async () => {
      localStorage.setItem("lexy.livePreview", "1");
      await renderWriter();
      await waitFor(() => expect(preview()).toHaveTextContent("pdf 1,2,3"));
      expect(compileProject).toHaveBeenCalledWith(MAIN, []);
    });

    it("asks which file is main when several are candidates, then remembers it", async () => {
      const project = { ...PROJECT, mainDocument: null, candidates: [MAIN, "other.tex"] };
      const { user } = await renderWriter(project);
      const dialog = await screen.findByRole("dialog", { name: "Main document" });
      expect(within(dialog).getByText("Which file is the main document?")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("radio", { name: "other.tex" }));
      disk["other.tex"] = "\\documentclass{report}";
      vi.mocked(setMainDocument).mockResolvedValue(undefined);
      await user.click(within(dialog).getByRole("button", { name: "Use this" }));
      expect(setMainDocument).toHaveBeenCalledWith("other.tex");
      await waitFor(() => expect(editor()).toHaveValue("\\documentclass{report}"));
      expect(within(title()).getByText("Main")).toBeInTheDocument();
    });

    it("explains how to pick a main document when there is none", async () => {
      await renderWriter({ ...PROJECT, mainDocument: null, candidates: [] });
      expect(await screen.findByText(/No main document found\. Pick a \.tex file in the sidebar/)).toBeInTheDocument();
    });

    it("without a main document, F5 asks for one but live preview stays quiet", async () => {
      localStorage.setItem("lexy.livePreview", "1");
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { user } = await renderWriter({ ...PROJECT, mainDocument: null, candidates: [] });
      await openIntro(user);
      type("x");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(screen.queryByRole("dialog", { name: "Main document" })).not.toBeInTheDocument();
      expect(compileProject).not.toHaveBeenCalled();
      await user.keyboard("{F5}");
      expect(await screen.findByRole("dialog", { name: "Main document" })).toBeInTheDocument();
    });
  });

  describe("files", () => {
    it("switching files keeps unsaved edits in each file", async () => {
      const { user } = await renderWriter();
      type("!");
      expect(unsavedInTitle()).toBeInTheDocument();
      await openIntro(user);
      expect(unsavedInTitle()).not.toBeInTheDocument();
      expect(within(row(MAIN)).getByRole("img", { name: "Unsaved changes" })).toBeInTheDocument();
      type(" more");
      await user.click(row(MAIN));
      expect(editor()).toHaveValue(`${STARTER_DOCUMENT}!`);
      await user.click(row("intro.tex"));
      expect(editor()).toHaveValue("Intro text. more");
      expect(writeFile).not.toHaveBeenCalled();
    });

    it("opens non-text files with the default app", async () => {
      const { user } = await renderWriter();
      vi.mocked(openEntryExternal).mockResolvedValue(undefined);
      await user.click(await screen.findByRole("treeitem", { name: "fig.png" }));
      expect(openEntryExternal).toHaveBeenCalledWith("fig.png");
      expect(editor()).toHaveValue(STARTER_DOCUMENT);
    });

    it("Ctrl+S saves every modified file; a failed save keeps it unsaved with a notice", async () => {
      const { user } = await renderWriter();
      type("!");
      await openIntro(user);
      type("?");
      await user.keyboard("{Control>}s{/Control}");
      await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(2));
      expect(disk[MAIN]).toBe(`${STARTER_DOCUMENT}!`);
      expect(disk[INTRO]).toBe("Intro text.?");
      expect(screen.queryAllByRole("img", { name: "Unsaved changes" })).toHaveLength(0);

      vi.mocked(writeFile).mockRejectedValueOnce({ kind: "io", message: "Access is denied." });
      type("x");
      await user.keyboard("{Control>}s{/Control}");
      expect(await screen.findByText("Could not save intro.tex. Access is denied.")).toBeInTheDocument();
      expect(unsavedInTitle()).toBeInTheDocument();
    });

    it("Save as writes the current file under a new name in the project", async () => {
      const { user } = await renderWriter();
      await openIntro(user);
      type("!");
      await user.click(tab("File"));
      await user.click(screen.getByRole("button", { name: "Save as" }));
      const field = within(screen.getByRole("dialog", { name: "Save as" })).getByRole("textbox");
      expect(field).toHaveValue(INTRO);
      await user.clear(field);
      await user.type(field, "chapters/copy.tex{Enter}");
      expect(writeFile).toHaveBeenCalledWith("chapters\\copy.tex", "Intro text.!");
      expect(within(title()).getByText("chapters\\copy.tex")).toBeInTheDocument();
    });

    it("New file creates and opens it", async () => {
      const { user } = await renderWriter();
      vi.mocked(createFile).mockImplementation((rel) => {
        disk[rel] = "";
        return Promise.resolve();
      });
      await screen.findByRole("treeitem", { name: MAIN });
      await user.keyboard("{Control>}n{/Control}");
      const field = within(screen.getByRole("dialog", { name: "New file" })).getByRole("textbox");
      await user.clear(field);
      await user.type(field, "notes.tex{Enter}");
      expect(createFile).toHaveBeenCalledWith("notes.tex");
      await waitFor(() => expect(within(title()).getByText("notes.tex")).toBeInTheDocument());
    });

    it("renaming an open file keeps its edits under the new name", async () => {
      const { user } = await renderWriter();
      await openIntro(user);
      type("!");
      vi.mocked(renameEntry).mockResolvedValue(undefined);
      act(() => row("intro.tex").focus());
      await user.keyboard("{F2}");
      const field = screen.getByRole("textbox", { name: "Rename intro.tex" });
      await user.clear(field);
      await user.type(field, "start.tex{Enter}");
      expect(renameEntry).toHaveBeenCalledWith(INTRO, "chapters\\start.tex");
      await waitFor(() => expect(within(title()).getByText("chapters\\start.tex")).toBeInTheDocument());
      expect(editor()).toHaveValue("Intro text.!");
    });

    it("deletes to the Recycle Bin, or permanently after asking when there is none", async () => {
      const { user } = await renderWriter();
      await openIntro(user);
      vi.mocked(deleteEntry).mockRejectedValueOnce({ kind: "noRecycleBin", message: "no bin" }).mockResolvedValueOnce(undefined);
      act(() => row("intro.tex").focus());
      await user.keyboard("{Delete}");
      await user.click(within(screen.getByRole("dialog", { name: "Delete" })).getByRole("button", { name: "Delete" }));
      expect(deleteEntry).toHaveBeenCalledWith(INTRO, false);
      const permanent = await screen.findByText("This drive has no Recycle Bin. Delete intro.tex permanently?");
      await user.click(within(permanent.closest("[role=dialog]") as HTMLElement).getByRole("button", { name: "Delete permanently" }));
      expect(deleteEntry).toHaveBeenLastCalledWith(INTRO, true);
      await waitFor(() => expect(editor()).toHaveValue(STARTER_DOCUMENT));
    });

    it("copies dropped files in, asking once about conflicts", async () => {
      const { user } = await renderWriter();
      await screen.findByRole("treeitem", { name: MAIN });
      await waitFor(() => expect(dropHandler).not.toBeNull());
      vi.mocked(importFiles)
        .mockResolvedValueOnce({ copied: ["chapters\\b.png"], skipped: [], conflicts: ["C:\\a.png", "C:\\c.png"] })
        .mockResolvedValueOnce({ copied: ["chapters\\a (2).png", "chapters\\c (2).png"], skipped: [], conflicts: [] });
      const original = document.elementFromPoint;
      document.elementFromPoint = () => row("chapters");
      act(() => dropHandler!({ payload: { type: "drop", paths: ["C:\\a.png", "C:\\b.png", "C:\\c.png"], position: { x: 1, y: 1 } } }));
      document.elementFromPoint = original;
      expect(importFiles).toHaveBeenCalledWith(["C:\\a.png", "C:\\b.png", "C:\\c.png"], "chapters", "ask");
      const dialog = await screen.findByRole("dialog", { name: "Files already exist" });
      expect(dialog).toHaveTextContent("2 files already exist.");
      await user.click(within(dialog).getByRole("button", { name: "Keep both" }));
      expect(importFiles).toHaveBeenLastCalledWith(["C:\\a.png", "C:\\c.png"], "chapters", "keepBoth");
    });
  });

  describe("compiling", () => {
    it("F5 saves all files, then compiles the main document and shows the PDF", async () => {
      const { user } = await renderWriter();
      await openIntro(user);
      type("!");
      await user.keyboard("{F5}");
      await waitFor(() => expect(compileProject).toHaveBeenCalledWith(MAIN, []));
      expect(disk[INTRO]).toBe("Intro text.!");
      expect(loadPdf).toHaveBeenCalledWith(PDF);
      expect(compileStatus()).toHaveTextContent("PDF ready");
      expect(preview()).toHaveTextContent("pdf 1,2,3");
      expect(drawer()).not.toBeInTheDocument();
    });

    it("disables Compile while running and ignores F5 meanwhile", async () => {
      const { user } = await renderWriter();
      const run = deferred<CompileResult>();
      vi.mocked(compileProject).mockReturnValueOnce(run.promise);
      await user.click(compileButton());
      expect(compileStatus()).toHaveTextContent("Compiling");
      expect(screen.getByRole("button", { name: "Compiling" })).toBeDisabled();
      await user.keyboard("{F5}");
      expect(compileProject).toHaveBeenCalledTimes(1);
      await act(async () => run.resolve(succeeded));
      expect(compileButton()).toBeEnabled();
    });

    it("opens the log with the first error on failure, and copies it", async () => {
      const { user } = await renderWriter();
      vi.mocked(compileProject).mockResolvedValueOnce(failed);
      await user.click(compileButton());
      expect(compileStatus()).toHaveTextContent("Compile failed");
      expect(drawer()).toHaveTextContent(failed.summary);
      expect(within(drawer()!).getByRole("tab", { name: /Problems/ })).toHaveAttribute("aria-selected", "true");
      await user.click(within(drawer()!).getByRole("tab", { name: "Log" }));
      expect(drawer()!.querySelector("pre")).toHaveTextContent("l.3 \\foo");
      expect(preview()).toHaveTextContent("Compile failed. Open log.");
      await user.click(screen.getByRole("button", { name: "Copy log" }));
      expect(await navigator.clipboard.readText()).toBe(failed.log);
    });

    it("treats a backend error or an unreadable PDF as a failure", async () => {
      const { user } = await renderWriter();
      vi.mocked(compileProject).mockRejectedValueOnce({ kind: "io", message: "compile task failed" });
      await user.click(compileButton());
      expect(drawer()).toHaveTextContent("compile task failed");
      vi.mocked(loadPdf).mockRejectedValueOnce("is not a Lexy build output");
      await user.click(compileButton());
      expect(compileStatus()).toHaveTextContent("Compile failed");
      expect(drawer()).toHaveTextContent("is not a Lexy build output");
    });

    it("asks for a new main document when the main file went missing", async () => {
      const { user } = await renderWriter();
      vi.mocked(compileProject).mockRejectedValueOnce({ kind: "notFound", message: "thesis.tex does not exist" });
      tree[""] = [entry("chapters", "folder"), entry("renamed.tex")];
      await user.click(compileButton());
      const dialog = await screen.findByRole("dialog", { name: "Main document" });
      expect(within(dialog).getByRole("radio", { name: "renamed.tex" })).toBeChecked();
    });
  });

  describe("live preview", () => {
    beforeEach(() => {
      localStorage.setItem("lexy.livePreview", "1");
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    async function liveWriter() {
      const result = await renderWriter();
      await waitFor(() => expect(compileProject).toHaveBeenCalledTimes(1));
      await act(async () => {});
      vi.mocked(compileProject).mockClear();
      return result;
    }

    it("compiles unsaved text from any open file about 1 s after typing stops, without saving", async () => {
      const { user } = await liveWriter();
      await openIntro(user);
      type("abc");
      expect(compileProject).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(compileProject).toHaveBeenCalledTimes(1);
      expect(compileProject).toHaveBeenCalledWith(MAIN, [{ path: INTRO, text: "Intro text.abc" }]);
      expect(writeFile).not.toHaveBeenCalled();
    });

    it("shows live failures in the status and banner without opening the log, keeping the last PDF", async () => {
      await liveWriter();
      expect(preview()).toHaveTextContent("pdf 1,2,3");
      vi.mocked(compileProject).mockResolvedValueOnce(failed);
      type("\\foo");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(compileStatus()).toHaveTextContent("Preview failed");
      expect(preview()).toHaveTextContent(`Preview failed: ${failed.summary}`);
      expect(preview()).toHaveTextContent("pdf 1,2,3");
      expect(drawer()).not.toBeInTheDocument();
    });

    it("View → Live preview turns it off and remembers that", async () => {
      const { user } = await liveWriter();
      await user.click(tab("View"));
      await user.click(screen.getByRole("button", { name: "Live preview" }));
      expect(localStorage.getItem("lexy.livePreview")).toBe("0");
      type("abc");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(compileProject).not.toHaveBeenCalled();
    });
  });

  describe("outside changes", () => {
    it("reloads a clean open file and flags a modified one", async () => {
      const { user } = await renderWriter();
      await openIntro(user);
      disk[INTRO] = "Changed in Notepad.";
      await act(async () => events.get("project-changed")!({ payload: { paths: [INTRO] } }));
      await waitFor(() => expect(editor()).toHaveValue("Changed in Notepad."));

      type("!");
      disk[INTRO] = "Changed again.";
      await act(async () => events.get("project-changed")!({ payload: { paths: [INTRO] } }));
      expect(await screen.findByText("intro.tex changed on disk.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Keep mine" }));
      expect(editor()).toHaveValue("Changed in Notepad.!");
      await act(async () => events.get("project-changed")!({ payload: { paths: [INTRO] } }));
      await user.click(await screen.findByRole("button", { name: "Reload" }));
      await waitFor(() => expect(editor()).toHaveValue("Changed again."));
    });

    it("shows a bar when the project folder disappears", async () => {
      await renderWriter();
      await act(async () => events.get("project-missing")!({ payload: null }));
      expect(screen.getByText("Project folder is missing.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save as new project" })).toBeInTheDocument();
    });
  });

  describe("document settings live in the main document", () => {
    it("picking Palatino writes Lexy's settings block after \\documentclass", async () => {
      const { user } = await renderWriter();
      await user.click(screen.getByRole("combobox", { name: "Font" }));
      await user.click(screen.getByRole("option", { name: "Palatino" }));
      expect(editor().value).toContain(`\\documentclass[10pt]{article}\n${BLOCK_START}`);
      expect(editor().value).toContain("\\usepackage{newpxtext,newpxmath}");
    });

    it("picking a kriti.app font copies it into the project and sets it with Bengali shaping", async () => {
      const { user } = await renderWriter();
      await user.click(screen.getByRole("combobox", { name: "Font" }));
      await user.click(await screen.findByRole("option", { name: "Kalpurush" }));
      const { installKritiFont } = await import("./latex/fonts");
      await waitFor(() => expect(installKritiFont).toHaveBeenCalledWith(MAIN, "Kalpurush"));
      await waitFor(() => expect(editor().value).toContain("\\setmainfont{Kalpurush.ttf}[Path=fonts/, Script=Bengali]"));
      expect(editor().value.startsWith(XELATEX_MARKER)).toBe(true);
      expect(await screen.findByText("Kalpurush copied to fonts and set as the document font.")).toBeInTheDocument();
    });

    it("applies to the main document while another file is shown", async () => {
      const { user } = await renderWriter();
      await openIntro(user);
      await user.selectOptions(screen.getByRole("combobox", { name: "Font size" }), "12");
      expect(editor()).toHaveValue("Intro text.");
      expect(screen.getByText("Applied to thesis.tex")).toBeInTheDocument();
      await user.click(row(MAIN));
      expect(editor().value).toContain("\\documentclass[12pt]{article}");
    });

    it("an installed font switches to XeLaTeX; a built-in one switches back", async () => {
      const { user } = await renderWriter();
      await user.click(screen.getByRole("combobox", { name: "Font" }));
      await user.click(await screen.findByRole("option", { name: "Georgia" }));
      expect(editor().value.startsWith(`${XELATEX_MARKER}\n`)).toBe(true);
      await user.click(screen.getByRole("combobox", { name: "Font" }));
      await user.click(screen.getByRole("option", { name: "Times" }));
      expect(editor().value).not.toContain(XELATEX_MARKER);
    });

    it("explains when there is no \\documentclass to attach settings to", async () => {
      disk[MAIN] = "just text";
      const { user } = await renderWriter();
      await user.selectOptions(screen.getByRole("combobox", { name: "Font size" }), "11");
      expect(screen.getByRole("alert")).toHaveTextContent("Add a \\documentclass line first.");
      expect(editor()).toHaveValue("just text");
    });
  });

  describe("Home and Insert actions", () => {
    it("Bold wraps the selection; Ctrl+I formats inside the editor only", async () => {
      const { user } = await renderWriter();
      const start = STARTER_DOCUMENT.indexOf("Start writing");
      select(start, start + 5);
      await user.click(screen.getByRole("button", { name: "Bold" }));
      expect(editor().value).toContain("\\textbf{Start} writing here.");
      const at = editor().value.indexOf("writing");
      select(at, at + 7);
      fireEvent.keyDown(editor(), { key: "i", ctrlKey: true });
      expect(editor().value).toContain("\\textit{writing}");
      const before = editor().value;
      fireEvent.keyDown(tab("Home"), { key: "b", ctrlKey: true });
      expect(editor().value).toBe(before);
    });

    it("Styles → Heading 1 and Bullets", async () => {
      const { user } = await renderWriter();
      select(STARTER_DOCUMENT.indexOf("Start writing") + 2);
      await user.click(screen.getByRole("button", { name: "Styles" }));
      await user.click(screen.getByRole("menuitem", { name: /Heading 1/ }));
      expect(editor().value).toContain("\\section{Start writing here.}");
    });

    it("Insert → Table and Equation", async () => {
      const { user } = await renderWriter();
      await user.click(tab("Insert"));
      select(STARTER_DOCUMENT.indexOf("\\end{document}"));
      await user.click(screen.getByRole("button", { name: "Table" }));
      await user.click(screen.getByRole("gridcell", { name: "3 x 2" }));
      expect(editor().value).toContain("\\begin{tabular}{|l|l|l|}");
      select(editor().value.indexOf("\\end{document}"));
      await user.click(screen.getByRole("button", { name: "Equation" }));
      await user.type(await screen.findByLabelText("LaTeX math"), "E=mc^2");
      await user.click(screen.getByRole("button", { name: "Insert" }));
      expect(editor().value).toContain("\\begin{equation}\n  E=mc^2\n\\end{equation}\n\\end{document}");
    });
  });

  describe("shortcuts and layout", () => {
    it("Ctrl+O opens a folder, Ctrl+L toggles the log, Ctrl+Shift+E toggles the sidebar", async () => {
      const { user, onSwitch } = await renderWriter();
      vi.mocked(chooseProjectFolder).mockResolvedValueOnce("D:\\Other");
      await user.keyboard("{Control>}o{/Control}");
      await waitFor(() => expect(onSwitch).toHaveBeenCalledWith("D:\\Other"));
      await user.keyboard("{Control>}l{/Control}");
      expect(drawer()).toBeInTheDocument();
      expect(screen.getByRole("complementary", { name: "Project files" })).toBeInTheDocument();
      await user.keyboard("{Control>}{Shift>}E{/Shift}{/Control}");
      expect(screen.queryByRole("complementary", { name: "Project files" })).not.toBeInTheDocument();
      expect(localStorage.getItem("lexy.filesOpen")).toBe("0");
    });

    it("handles shortcuts before the editor sees them", async () => {
      await renderWriter();
      const inner = vi.fn();
      editor().addEventListener("keydown", inner);
      expect(fireEvent.keyDown(editor(), { key: "l", ctrlKey: true })).toBe(false);
      expect(inner).not.toHaveBeenCalled();
      expect(fireEvent.keyDown(editor(), { key: "q", ctrlKey: true })).toBe(true);
      expect(inner).toHaveBeenCalled();
    });

    it("resizes the sidebar and the editor/preview split with the keyboard", async () => {
      const { user } = await renderWriter();
      const sidebar = screen.getByRole("separator", { name: "Resize file list" });
      sidebar.focus();
      await user.keyboard("{ArrowRight}");
      expect(sidebar).toHaveAttribute("aria-valuenow", "240");
      expect(localStorage.getItem("lexy.sidebarWidth")).toBe("240");
      const split = screen.getByRole("separator", { name: "Resize editor and preview" });
      split.focus();
      await user.keyboard("{ArrowRight}");
      expect(split).toHaveAttribute("aria-valuenow", "55");
      await user.dblClick(split);
      expect(split).toHaveAttribute("aria-valuenow", "50");
    });

    it("log drawer toggles from the View tab", async () => {
      const { user } = await renderWriter();
      await user.click(tab("View"));
      await user.click(screen.getByRole("button", { name: "Show logs" }));
      expect(within(drawer()!).getByText("No compile yet")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Hide logs" }));
      expect(drawer()).not.toBeInTheDocument();
    });
  });

  describe("leaving the project", () => {
    async function close() {
      const event = { preventDefault: vi.fn() };
      let done!: Promise<void>;
      await act(async () => {
        done = closeHandler!(event);
      });
      return { event, done };
    }

    it("one prompt lists every unsaved file; Cancel keeps the window open", async () => {
      const { user } = await renderWriter();
      type("!");
      await openIntro(user);
      type("?");
      const { event, done } = await close();
      const dialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
      expect(within(dialog).getAllByRole("listitem").map((item) => item.textContent)).toEqual([INTRO, MAIN]);
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await act(() => done);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });

    it("Save all writes every file, then exports a fresh PDF beside the main document", async () => {
      const { user } = await renderWriter();
      type("!");
      await openIntro(user);
      type("?");
      const { event, done } = await close();
      await user.click(within(await screen.findByRole("dialog", { name: "Unsaved changes" })).getByRole("button", { name: "Save all" }));
      await act(() => done);
      expect(disk[MAIN]).toBe(`${STARTER_DOCUMENT}!`);
      expect(disk[INTRO]).toBe("Intro text.?");
      expect(compileProject).toHaveBeenCalledWith(MAIN, []);
      expect(exportPdf).toHaveBeenCalledWith(PDF, `${ROOT}\\${MAIN}`);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("reuses a PDF compiled from the saved files without compiling again", async () => {
      const { user } = await renderWriter();
      await user.click(compileButton());
      await waitFor(() => expect(compileStatus()).toHaveTextContent("PDF ready"));
      vi.mocked(compileProject).mockClear();
      const { done } = await close();
      await act(() => done);
      expect(compileProject).not.toHaveBeenCalled();
      expect(exportPdf).toHaveBeenCalledWith(PDF, `${ROOT}\\${MAIN}`);
    });

    it("compiles the saved files first when the last PDF came from unsaved text", async () => {
      localStorage.setItem("lexy.livePreview", "1");
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { user } = await renderWriter();
      await waitFor(() => expect(compileProject).toHaveBeenCalledTimes(1));
      type("draft");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(compileProject).toHaveBeenLastCalledWith(MAIN, [{ path: MAIN, text: `${STARTER_DOCUMENT}draft` }]);
      vi.mocked(compileProject).mockClear();
      vi.mocked(compileProject).mockResolvedValueOnce({ ...succeeded, pdfPath: "C:\\build\\saved.pdf" });
      const { done } = await close();
      await user.click(within(await screen.findByRole("dialog", { name: "Unsaved changes" })).getByRole("button", { name: "Don't save" }));
      await act(() => done);
      expect(compileProject).toHaveBeenCalledWith(MAIN, []);
      expect(exportPdf).toHaveBeenCalledWith("C:\\build\\saved.pdf", `${ROOT}\\${MAIN}`);
    });

    it("stays open once with a notice when the PDF can't be written, then lets you quit", async () => {
      await renderWriter();
      vi.mocked(exportPdf).mockRejectedValue("failed to save thesis.pdf: Access is denied.");
      const first = await close();
      await act(() => first.done);
      expect(first.event.preventDefault).toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent("Close again to quit without it.");
      const second = await close();
      await act(() => second.done);
      expect(second.event.preventDefault).not.toHaveBeenCalled();
    });

    it("File → Project Home settles unsaved files, then leaves; unsubscribes on unmount", async () => {
      const { user, onSwitch, unmount } = await renderWriter();
      type("!");
      await user.click(tab("File"));
      await user.click(screen.getByRole("button", { name: "Project Home" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Unsaved changes" })).getByRole("button", { name: "Save all" }));
      await waitFor(() => expect(onSwitch).toHaveBeenCalledWith(null));
      expect(disk[MAIN]).toBe(`${STARTER_DOCUMENT}!`);
      unmount();
      expect(unlistenClose).toHaveBeenCalled();
    });
  });

  describe("read-only project", () => {
    it("shows the bar and blocks saving and compiling", async () => {
      localStorage.setItem("lexy.livePreview", "1");
      const { user } = await renderWriter({ ...PROJECT, readOnly: true });
      expect(screen.getByText("Open in another Lexy window. Read-only.")).toBeInTheDocument();
      expect(compileButton()).toBeDisabled();
      type("!");
      await user.keyboard("{Control>}s{/Control}");
      await user.keyboard("{F5}");
      expect(writeFile).not.toHaveBeenCalled();
      expect(compileProject).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "New file" })).toBeDisabled();
    });
  });

  describe("git", () => {
    it("Ctrl+Shift+G opens the Git panel and the sidebar marks changed files", async () => {
      const { user } = await renderWriter();
      expect(await screen.findByLabelText("Git: M")).toBeInTheDocument();
      await user.keyboard("{Control>}{Shift>}g{/Shift}{/Control}");
      expect(await screen.findByRole("complementary", { name: "Version history" })).toBeInTheDocument();
      expect(screen.getByText("1 change")).toBeInTheDocument();
      await user.keyboard("{Control>}{Shift>}g{/Shift}{/Control}");
      await waitFor(() => expect(screen.queryByRole("complementary", { name: "Version history" })).toBeNull());
    });
  });

  describe("Bangla font", () => {
    it("offers BCC Purno once after a compile that needed a font, and adds it to the main document", async () => {
      const { user } = await renderWriter();
      vi.mocked(compileProject).mockResolvedValueOnce({ ...succeeded, engine: "xelatex", autoFont: "Nirmala UI" });
      vi.mocked(installBanglaFont).mockResolvedValueOnce(["fonts/BCCPurno-Regular.ttf"]);
      await user.keyboard("{F5}");
      await user.click(await screen.findByRole("button", { name: "Add font" }));
      await waitFor(() => expect(installBanglaFont).toHaveBeenCalledWith(MAIN));
      await waitFor(() => expect(editor().value).toContain("\\setmainfont{BCCPurno}"));
      expect(editor().value.startsWith("% !TEX program = xelatex")).toBe(true);
      expect(await screen.findByText(/BCC Purno added to fonts/)).toBeInTheDocument();

      // Not offered again for this project.
      vi.mocked(compileProject).mockResolvedValueOnce({ ...succeeded, autoFont: "Nirmala UI" });
      await user.keyboard("{F5}");
      await waitFor(() => expect(compileProject).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole("button", { name: "Add font" })).toBeNull();
    });

    it("Don't ask again is remembered; read-only windows never offer", async () => {
      const { user } = await renderWriter();
      vi.mocked(compileProject).mockResolvedValue({ ...succeeded, autoFont: "Nirmala UI" });
      await user.keyboard("{F5}");
      await user.click(await screen.findByRole("button", { name: "Don't ask again" }));
      await user.keyboard("{F5}");
      await waitFor(() => expect(compileProject).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole("button", { name: "Add font" })).toBeNull();
      expect(installBanglaFont).not.toHaveBeenCalled();
    });
  });

  describe("PDF ↔ source and problems", () => {
    async function withPdf() {
      localStorage.setItem("lexy.livePreview", "1");
      const result = await renderWriter();
      await waitFor(() => expect(screen.getByTestId("pdf")).toHaveTextContent("pdf 1,2,3"));
      return result;
    }

    it("double-clicking the PDF opens the sub-file and jumps to the line", async () => {
      const { user } = await withPdf();
      vi.mocked(syncToSource).mockResolvedValueOnce({ kind: "project", file: "chapters/intro.tex", line: 4 });
      await user.dblClick(screen.getByTestId("pdf"));
      await waitFor(() => expect(spies.jumpToLine).toHaveBeenCalledWith(INTRO, 4));
      expect(syncToSource).toHaveBeenCalledWith(MAIN, 2, 10, 20);
      expect(editor()).toHaveValue("Intro text.");
    });

    it("names files outside the project instead of jumping", async () => {
      const { user } = await withPdf();
      vi.mocked(syncToSource).mockResolvedValueOnce({ kind: "external", name: "article.cls" });
      await user.dblClick(screen.getByTestId("pdf"));
      expect(await screen.findByText("Text is in article.cls")).toBeInTheDocument();
      expect(spies.jumpToLine).not.toHaveBeenCalled();
    });

    it("Ctrl+J shows the cursor line in the PDF, or asks to compile first", async () => {
      localStorage.setItem("lexy.livePreview", "0");
      const { user, unmount } = await renderWriter();
      await user.keyboard("{Control>}j{/Control}");
      expect(await screen.findByText("Compile first")).toBeInTheDocument();
      unmount();

      const spot = { page: 2, x: 72, y: 100, width: 300, height: 10 };
      vi.mocked(syncToPdf).mockResolvedValueOnce(spot);
      const second = await withPdf();
      await second.user.keyboard("{Control>}j{/Control}");
      await waitFor(() => expect(spies.showSpot).toHaveBeenCalledWith(spot));
      expect(syncToPdf).toHaveBeenCalledWith(MAIN, MAIN, 7);
    });

    it("lists problems after F5, marks them inline, and jumps from a row", async () => {
      const { user } = await renderWriter();
      vi.mocked(compileProject).mockResolvedValueOnce({
        ...failed,
        problems: [
          { severity: "error", file: "chapters/intro.tex", line: 3, message: "Undefined control sequence." },
          { severity: "warning", file: null, line: null, message: "article.cls: Something" },
        ],
      });
      await user.keyboard("{F5}");
      const list = await screen.findByRole("list", { name: "Problems" });
      expect(within(drawer()!).getByRole("tab", { name: "Problems (2)" })).toBeInTheDocument();
      expect(within(list).queryAllByRole("button")).toHaveLength(1);
      expect(spies.setProblems).toHaveBeenCalledWith(MAIN, []);
      await user.click(within(list).getByRole("button", { name: /chapters\/intro\.tex:3/ }));
      await waitFor(() => expect(spies.jumpToLine).toHaveBeenCalledWith(INTRO, 3));
      expect(spies.setProblems).toHaveBeenCalledWith(INTRO, [expect.objectContaining({ line: 3 })]);
    });

    it("keeps the last good PDF with a note when a compile fails", async () => {
      const { user } = await withPdf();
      vi.mocked(compileProject).mockResolvedValueOnce(failed);
      await user.keyboard("{F5}");
      expect(await screen.findByText("Preview is from the last successful compile.")).toBeInTheDocument();
      expect(screen.getByTestId("pdf")).toHaveTextContent("pdf 1,2,3");
      vi.mocked(compileProject).mockResolvedValueOnce(succeeded);
      await user.keyboard("{F5}");
      await waitFor(() => expect(screen.queryByText("Preview is from the last successful compile.")).toBeNull());
    });
  });
});
