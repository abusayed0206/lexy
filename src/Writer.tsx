import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exportPdf, loadPdf, syncToPdf, syncToSource, type CompileResult, type Problem } from "./compile";
import { Editor, type EditorHandle } from "./Editor";
import { findEquationAt, wrapEquation, type FoundEquation } from "./latex/equations";
import type { FontChoice } from "./latex/fonts";
import { footnote, insertBlock, pageBreak, replaceWith, setHeading, toList, wrap, type TextEdit } from "./latex/format";
import { applySettings, conflicts, hasSettingsBlock, parseSettings, type DocumentSettings, type FontSize } from "./latex/settings";
import { tableLatex, type TableSpec } from "./latex/tables";
import { createLivePreview, type LivePreview } from "./livePreview";
import { dirtyFiles, emptyOpenFiles, isDirty, keyOf, openFilesReducer, type OpenFilesEvent } from "./openFiles";
import { gitStatus, STATUS_LETTER, type GitState } from "./git";
import { GitPanel, type GitAction } from "./GitPanel";
import { PdfView, type PdfViewHandle } from "./PdfView";
import { zoomLabel, type Zoom } from "./pdfView/zoom";
import { Problems } from "./Problems";
import { chooseProjectFolder, useChoice, useNamePrompt } from "./ProjectDialogs";
import {
  absolutePath,
  baseName,
  compileProject,
  createFile,
  createFolder,
  createProject,
  deleteEntry,
  errorText,
  importFiles,
  isProjectError,
  joinRel,
  listDir,
  listProjects,
  openEntryExternal,
  parentOf,
  readFile,
  renameEntry,
  sameRel,
  setMainDocument,
  writeFile,
  type Buffer,
  type Entry,
  type OpenedProject,
  type ProjectSummary,
} from "./projects";
import { Ribbon, type RibbonActions } from "./Ribbon";
import { Dialog } from "./ribbon/Dialog";
import type { EquationResult } from "./ribbon/EquationDialog";
import { Sidebar } from "./Sidebar";
import { STARTER_DOCUMENT } from "./starter";

const EquationDialog = lazy(() => import("./ribbon/EquationDialog"));

type Status = "idle" | "dirty" | "compiling" | "ready" | "error";
type Origin = "live" | "explicit";

type CompileState = {
  status: Status;
  summary: string | null;
  log: string;
  pdfPath: string | null;
  origin: Origin | null;
  /** An explicit (F5/Compile) run is in flight; only this disables the Compile button. */
  explicitBusy: boolean;
  /** Engine of the last result (spec 005: Lexy may pick XeLaTeX on its own, so show it). */
  engine: CompileResult["engine"] | null;
};

export const ENGINE_NAMES: Record<CompileResult["engine"], string> = { pdflatex: "pdfLaTeX", xelatex: "XeLaTeX", lualatex: "LuaLaTeX" };

/** Status tooltip: "XeLaTeX · PDF ready", or the error summary after a failure. */
export function statusDetail(state: CompileState): string | null {
  const text = state.status === "error" ? state.summary : state.engine ? statusLabel(state) : null;
  if (!text) return null;
  return state.engine ? `${ENGINE_NAMES[state.engine]} · ${text}` : text;
}

type CompileEvent =
  | { type: "edit" }
  | { type: "reset" }
  | { type: "start"; origin: Origin }
  | { type: "done"; origin: Origin; result: CompileResult };

const initialState: CompileState = {
  status: "idle",
  summary: null,
  log: "",
  pdfPath: null,
  origin: null,
  explicitBusy: false,
  engine: null,
};

export function compileReducer(state: CompileState, event: CompileEvent): CompileState {
  switch (event.type) {
    case "edit":
      return state.status === "compiling" ? state : { ...state, status: "dirty" };
    case "reset":
      return initialState;
    case "start":
      if (event.origin === "explicit" && state.explicitBusy) return state;
      return { ...state, status: "compiling", explicitBusy: state.explicitBusy || event.origin === "explicit" };
    case "done": {
      const explicitBusy = event.origin === "explicit" ? false : state.explicitBusy;
      return {
        status: explicitBusy ? "compiling" : event.result.ok ? "ready" : "error",
        summary: event.result.summary,
        log: event.result.log,
        pdfPath: event.result.pdfPath,
        origin: event.origin,
        explicitBusy,
        engine: event.result.engine,
      };
    }
  }
}

export function statusLabel(state: CompileState): string {
  if (state.status === "error") return state.origin === "live" ? "Preview failed" : "Compile failed";
  return { idle: "Idle", dirty: "Changed", compiling: "Compiling", ready: "PDF ready" }[state.status];
}

export const MIN_SPLIT = 0.2;
export const MAX_SPLIT = 0.8;
export const MIN_SIDEBAR = 160;
export const MAX_SIDEBAR = 400;
const SPLIT_KEY = "lexy.split";
const LIVE_KEY = "lexy.livePreview";
const SIDEBAR_KEY = "lexy.sidebarWidth";
const FILES_KEY = "lexy.filesOpen";

export function clampSplit(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ratio));
}

export function clampSidebar(width: number): number {
  if (!Number.isFinite(width)) return 220;
  return Math.round(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, width)));
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the preference just isn't remembered.
  }
}

function loadSplit(): number {
  const saved = readStorage(SPLIT_KEY);
  return saved === null ? 0.5 : clampSplit(Number(saved));
}

/** Sidebar starts collapsed in narrow windows unless the user chose otherwise (contracts/ui.md). */
function loadFilesOpen(): boolean {
  const saved = readStorage(FILES_KEY);
  if (saved !== null) return saved === "1";
  return typeof window === "undefined" || window.innerWidth >= 900;
}

type EquationTarget = { found: FoundEquation | null };

type Props = {
  project: OpenedProject;
  /** Leave this project: open another folder, or `null` for Project Home. Unsaved work is handled first. */
  onSwitch: (target: string | null) => void;
};

export function Writer({ project, onSwitch }: Props) {
  const readOnly = project.readOnly;
  const [files, dispatchFiles] = useReducer(openFilesReducer, { ...emptyOpenFiles, main: project.mainDocument });
  const [state, dispatch] = useReducer(compileReducer, initialState);
  const [logsOpen, setLogsOpen] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [split, setSplit] = useState(loadSplit);
  const [sidebarWidth, setSidebarWidth] = useState(() => clampSidebar(Number(readStorage(SIDEBAR_KEY) ?? 220)));
  const [filesOpen, setFilesOpen] = useState(loadFilesOpen);
  const [liveEnabled, setLiveEnabled] = useState(() => readStorage(LIVE_KEY) !== "0" && !readOnly);
  const [equation, setEquation] = useState<EquationTarget | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const [mainChooser, setMainChooser] = useState<string[] | null>(null);
  const [git, setGit] = useState<GitState | null>(null);
  const [gitOpen, setGitOpen] = useState(false);
  const [gitRequest, setGitRequest] = useState<{ action: GitAction; seq: number } | null>(null);
  const panes = useRef<HTMLDivElement>(null);
  const pdfView = useRef<PdfViewHandle>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [drawerTab, setDrawerTab] = useState<"problems" | "log">("problems");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const dragging = useRef<"split" | "sidebar" | null>(null);
  const editor = useRef<EditorHandle>(null);
  const live = useRef<LivePreview | null>(null);
  const conflictWarned = useRef(false);
  const { ask, dialog: choiceDialog } = useChoice();
  const { prompt, dialog: nameDialog } = useNamePrompt();

  const filesRef = useRef(files);
  filesRef.current = files;
  /** Dispatch and update the ref at once, so code later in the same handler (save, then compile) sees the change. */
  function applyFiles(event: OpenFilesEvent) {
    filesRef.current = openFilesReducer(filesRef.current, event);
    dispatchFiles(event);
  }
  /** Bumped on every save or outside change, so the exit export knows if the last PDF still matches disk. */
  const diskVersion = useRef(0);
  /** The PDF in the build folder and whether it was compiled from exactly what is on disk. */
  const lastPdf = useRef<{ pdfPath: string; clean: boolean; diskVersion: number } | null>(null);
  const exportWarned = useRef(false);
  const editSeq = useRef(0);

  const current = files.current;
  const currentFile = current !== null ? files.files.get(current) : undefined;
  const main = files.main;
  const mainText = main !== null ? (files.files.get(keyOf(files, main) ?? main)?.text ?? null) : null;
  const dirty = useMemo(() => dirtyFiles(files), [files]);
  const dirtySet = useMemo(() => new Set(dirty.map((path) => path.toLowerCase())), [dirty]);

  // Inline problems in every open file; a file without problems is cleared (spec 003 US3).
  const openKeys = [...files.files.keys()].join("|");
  useEffect(() => {
    const byFile = new Map<string, Problem[]>();
    for (const problem of problems) {
      if (!problem.file) continue;
      const key = problem.file.toLowerCase();
      byFile.set(key, [...(byFile.get(key) ?? []), problem]);
    }
    for (const path of files.files.keys()) {
      editor.current?.setProblems(path, byFile.get(path.split("\\").join("/").toLowerCase()) ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problems, openKeys, current]);

  const settings = useMemo(() => parseSettings(mainText ?? ""), [mainText]);
  const settingsManaged = useMemo(() => hasSettingsBlock(mainText ?? ""), [mainText]);

  /** Unsaved open files, sent with every compile (never written to disk). */
  function buffers(): Buffer[] {
    const state = filesRef.current;
    return dirtyFiles(state).map((path) => ({ path, text: state.files.get(path)!.text }));
  }

  async function showResult(result: CompileResult, origin: Origin, clean: boolean, version: number) {
    let final = result;
    if (result.ok && result.pdfPath) {
      try {
        setPdfBytes(await loadPdf(result.pdfPath));
        lastPdf.current = { pdfPath: result.pdfPath, clean, diskVersion: version };
      } catch (error) {
        const message = errorText(error);
        final = { ...result, ok: false, summary: message, log: message, pdfPath: null };
      }
    }
    dispatch({ type: "done", origin, result: final });
    setProblems(final.problems ?? (final.ok ? [] : [{ severity: "error", file: null, line: null, message: final.summary }]));
    if (origin === "explicit" && !final.ok) {
      setDrawerTab("problems");
      setLogsOpen(true);
    }
  }

  function failure(error: unknown): CompileResult {
    const text = errorText(error);
    return { ok: false, summary: text, log: text, pdfPath: null, engine: "pdflatex" };
  }

  /** Compile the main document with the unsaved buffers; a missing main asks for a new one. */
  async function compileNow(origin: Origin): Promise<CompileResult> {
    const target = filesRef.current.main;
    if (target === null) {
      // Only an explicit compile asks; live preview must not pop up dialogs while typing.
      if (origin === "explicit") void chooseMain();
      return failure("Choose a main document first.");
    }
    const sent = buffers();
    const version = diskVersion.current;
    dispatch({ type: "start", origin });
    let result: CompileResult;
    try {
      result = await compileProject(target, sent);
    } catch (error) {
      if (isProjectError(error, "notFound")) void chooseMain(`${target} is missing. Choose the main document.`);
      result = failure(error);
    }
    await showResult(result, origin, sent.length === 0, version);
    return result;
  }
  const compileRef = useRef(compileNow);
  compileRef.current = compileNow;

  /**
   * On exit, write the PDF beside the main document. It must match what is saved on disk,
   * so if the last PDF came from unsaved text or older files, compile the saved files first.
   */
  async function exportPdfOnExit() {
    const target = filesRef.current.main;
    if (target === null || readOnly) return;
    let pdf = lastPdf.current;
    if (!pdf || !pdf.clean || pdf.diskVersion !== diskVersion.current) {
      const result = await compileProject(target, []);
      if (!result.ok || !result.pdfPath) throw new Error(`the saved document doesn't compile (${result.summary})`);
      pdf = { pdfPath: result.pdfPath, clean: true, diskVersion: diskVersion.current };
    }
    await exportPdf(pdf.pdfPath, absolutePath(project.root, target));
  }

  // Live preview: compile ~1 s after typing stops in any file (research R5 of spec 001).
  useEffect(() => {
    const scheduler = createLivePreview({
      compile: () => compileRef.current("live"),
      // Results are shown inside compileNow.
      onResult: () => undefined,
    });
    scheduler.setEnabled(liveEnabled);
    live.current = scheduler;
    return () => scheduler.dispose();
    // Created once; edits and toggles are pushed into it below.
  }, []);

  useEffect(() => {
    live.current?.setEnabled(liveEnabled);
    if (!readOnly) writeStorage(LIVE_KEY, liveEnabled ? "1" : "0");
  }, [liveEnabled]);

  // Open the main document (or ask which one it is).
  useEffect(() => {
    if (project.mainDocument) void openFile(project.mainDocument, { first: true });
    else if (project.candidates.length) setMainChooser(project.candidates);
    else setNotice("No main document found. Pick a .tex file in the sidebar and choose Set as main document.");
    void listProjects().then(setRecent, () => undefined);
  }, []);

  /** Show a text file; loads it from disk the first time. */
  async function openFile(path: string, { first = false } = {}) {
    const state = filesRef.current;
    const key = keyOf(state, path);
    if (key !== undefined) {
      editor.current?.switchTo(key, state.files.get(key)!.text);
      applyFiles({ type: "switched", path: key });
      return;
    }
    try {
      const text = await readFile(path);
      editor.current?.switchTo(path, text);
      applyFiles({ type: "opened", path, text });
      if (first && liveEnabled) live.current?.now(String(++editSeq.current));
    } catch (error) {
      setNotice(`Could not open ${baseName(path)}. ${errorText(error)}`);
    }
  }

  // ----- PDF ↔ source (spec 003) -----

  /** Open a project file (path from the backend, `/`-separated) and put the cursor on `line`. */
  async function jumpTo(file: string, line: number) {
    const path = file.split("/").join("\\");
    if (!sameRel(path, filesRef.current.current)) await openFile(path);
    editor.current?.jumpToLine(line);
  }

  async function showInSource(page: number, x: number, y: number) {
    const target = filesRef.current.main;
    if (target === null) return;
    try {
      const found = await syncToSource(target, page, x, y);
      if (found?.kind === "project") await jumpTo(found.file, found.line);
      else if (found?.kind === "external") setInfo(`Text is in ${found.name}`);
    } catch {
      setInfo("Click-to-jump needs a fresh compile");
    }
  }

  async function showInPdf() {
    const target = filesRef.current.main;
    const path = filesRef.current.current;
    if (target === null || path === null || !pdfBytes) {
      setInfo("Compile first");
      return;
    }
    try {
      const spot = await syncToPdf(target, path, editor.current?.cursorLine() ?? 1);
      if (spot) pdfView.current?.showSpot(spot);
      else setInfo("No PDF location for this line");
    } catch {
      setInfo("Compile first");
    }
  }

  function onEntryOpen(entry: Entry) {
    if (entry.editable) void openFile(entry.path);
    else openEntryExternal(entry.path).catch((error) => setNotice(`Could not open ${entry.name}. ${errorText(error)}`));
  }

  async function chooseMain(message?: string) {
    try {
      const entries = await listDir("");
      const candidates = entries.filter((entry) => entry.kind === "file" && /\.tex$/i.test(entry.name)).map((entry) => entry.path);
      if (!candidates.length) {
        setNotice(message ?? "No main document found. Pick a .tex file in the sidebar and choose Set as main document.");
        return;
      }
      setMainChooser(candidates);
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function setMain(path: string) {
    setMainChooser(null);
    try {
      await setMainDocument(path);
      applyFiles({ type: "mainSet", path });
      setNotice(null);
      await openFile(path);
      if (liveEnabled) live.current?.now(String(++editSeq.current));
    } catch (error) {
      setNotice(`Could not set the main document. ${errorText(error)}`);
    }
  }

  /** Save every modified file. Returns false if any save failed. */
  async function saveAll(): Promise<boolean> {
    if (readOnly) return false;
    const state = filesRef.current;
    let ok = true;
    for (const path of dirtyFiles(state)) {
      const text = state.files.get(path)!.text;
      try {
        await writeFile(path, text);
        applyFiles({ type: "saved", path, text });
        diskVersion.current++;
      } catch (error) {
        ok = false;
        setNotice(`Could not save ${baseName(path)}. ${errorText(error)}`);
      }
    }
    if (ok) setNotice((current) => (current?.startsWith("Could not save") ? null : current));
    void refreshGit();
    return ok;
  }

  // ----- Git (spec 006) -----

  async function refreshGit() {
    try {
      setGit(await gitStatus());
    } catch {
      setGit(null);
    }
  }

  function onGit(action: GitAction) {
    if (action === "changes" && gitOpen) {
      setGitOpen(false);
      return;
    }
    setGitOpen(true);
    setGitRequest((last) => ({ action, seq: (last?.seq ?? 0) + 1 }));
  }

  /** Before Git overwrites a file: unsaved edits in it need a yes, then they are dropped. */
  async function confirmRestoreFile(path: string): Promise<boolean> {
    const key = keyOf(filesRef.current, path);
    const file = key === undefined ? undefined : filesRef.current.files.get(key);
    if (key === undefined || !file || !isDirty(file)) return true;
    const choice = await ask("Discard unsaved edits?", `${baseName(key)} has unsaved edits. Restoring replaces them.`, [
      { label: "Restore", value: "yes", primary: true },
      { label: "Cancel", value: "no" },
    ]);
    if (choice !== "yes") return false;
    applyFiles({ type: "reloaded", path: key, text: file.savedText });
    return true;
  }

  useEffect(() => {
    void refreshGit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opening the panel checks the server for new commits (research R8).
  useEffect(() => {
    if (gitOpen && git?.remoteUrl) void gitStatus(true).then(setGit, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitOpen]);

  const gitChanges = useMemo(
    () => new Map((git?.changes ?? []).map((change) => [change.path.toLowerCase(), STATUS_LETTER[change.status]])),
    [git],
  );

  async function saveCurrentAs() {
    const from = filesRef.current.current;
    if (from === null || readOnly) return;
    const target = await prompt("Save as", "File name in this project", from);
    if (!target || sameRel(target, from)) return;
    const text = filesRef.current.files.get(from)!.text;
    try {
      await writeFile(target, text);
      diskVersion.current++;
      // The new file takes over the editor state; the old file keeps what is on disk.
      const wasMain = sameRel(from, filesRef.current.main);
      editor.current?.rename(from, target);
      applyFiles({ type: "renamed", from, to: target });
      applyFiles({ type: "saved", path: target, text });
      if (wasMain) applyFiles({ type: "mainSet", path: from });
      setTreeVersion((v) => v + 1);
    } catch (error) {
      setNotice(`Could not save ${baseName(target)}. ${errorText(error)}`);
    }
  }

  async function runCompile() {
    if (state.explicitBusy || readOnly) return;
    if (!(await saveAll())) return;
    await compileNow("explicit");
  }

  /** One prompt for all unsaved files; false means the user cancelled (or saving failed). */
  async function settleUnsaved(): Promise<boolean> {
    const pending = dirtyFiles(filesRef.current);
    if (!pending.length || readOnly) return true;
    const choice = await ask(
      "Unsaved changes",
      <>
        <p>Save changes to these files?</p>
        <ul className="file-list">
          {pending.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      </>,
      [
        { label: "Cancel", value: "cancel" },
        { label: "Don't save", value: "discard" },
        { label: "Save all", value: "save", primary: true },
      ],
    );
    if (choice === "save") return saveAll();
    return choice === "discard";
  }

  /** Leave the project: unsaved prompt, PDF export, then switch. */
  async function leave(target: string | null) {
    if (!(await settleUnsaved())) return;
    try {
      await exportPdfOnExit();
    } catch (error) {
      setNotice(`Lexy couldn't save the PDF next to your document: ${errorText(error)}`);
    }
    onSwitch(target);
  }

  async function openFolder() {
    try {
      const picked = await chooseProjectFolder(async () =>
        (await ask("Large folder", "This folder is large. Open anyway?", [
          { label: "Cancel", value: "cancel" },
          { label: "Open", value: "open", primary: true },
        ])) === "open",
      );
      if (picked) await leave(picked);
    } catch (error) {
      setNotice(`Could not open the folder. ${errorText(error)}`);
    }
  }

  async function newProject() {
    const name = await prompt("New project", "Project name", "Untitled");
    if (!name) return;
    if (name.includes("\\")) {
      setNotice("Use a project name without \\ or /.");
      return;
    }
    try {
      await leave(await createProject(name, STARTER_DOCUMENT));
    } catch (error) {
      setNotice(`Could not create the project. ${errorText(error)}`);
    }
  }

  // ----- sidebar actions -----

  async function newFile(dir: string) {
    if (readOnly) return;
    const name = await prompt("New file", "File name", "untitled.tex");
    if (!name) return;
    const path = joinRel(dir, name);
    try {
      await createFile(path);
      setTreeVersion((v) => v + 1);
      if (/\.(tex|bib|cls|sty|txt|bst|md)$/i.test(name)) await openFile(path);
    } catch (error) {
      setNotice(`Could not create ${name}. ${errorText(error)}`);
    }
  }

  async function newFolder(dir: string) {
    if (readOnly) return;
    const name = await prompt("New folder", "Folder name", "New folder");
    if (!name) return;
    try {
      await createFolder(joinRel(dir, name));
      setTreeVersion((v) => v + 1);
    } catch (error) {
      setNotice(`Could not create ${name}. ${errorText(error)}`);
    }
  }

  async function rename(entry: Entry, name: string): Promise<boolean> {
    const to = joinRel(parentOf(entry.path), name);
    try {
      await renameEntry(entry.path, to);
      editor.current?.rename(entry.path, to);
      applyFiles({ type: "renamed", from: entry.path, to });
      setTreeVersion((v) => v + 1);
      return true;
    } catch (error) {
      setNotice(`Could not rename ${entry.name}. ${errorText(error)}`);
      return !isProjectError(error, "nameTaken") && !isProjectError(error, "invalidName");
    }
  }

  async function remove(entry: Entry) {
    if (readOnly) return;
    const confirmed = await ask("Delete", `Move ${entry.name} to the Recycle Bin?`, [
      { label: "Cancel", value: "cancel" },
      { label: "Delete", value: "delete", primary: true },
    ]);
    if (confirmed !== "delete") return;
    try {
      try {
        await deleteEntry(entry.path, false);
      } catch (error) {
        if (!isProjectError(error, "noRecycleBin")) throw error;
        const permanent = await ask("Delete", `This drive has no Recycle Bin. Delete ${entry.name} permanently?`, [
          { label: "Cancel", value: "cancel" },
          { label: "Delete permanently", value: "delete", primary: true },
        ]);
        if (permanent !== "delete") return;
        await deleteEntry(entry.path, true);
      }
      forgetUnder(entry.path);
      setTreeVersion((v) => v + 1);
    } catch (error) {
      setNotice(`Could not delete ${entry.name}. ${errorText(error)}`);
    }
  }

  /** Drop open files at or below `path` (deleted), showing the main document instead. */
  function forgetUnder(path: string) {
    const state = filesRef.current;
    const next = openFilesReducer(state, { type: "deleted", path });
    for (const key of state.files.keys()) if (!next.files.has(key)) editor.current?.forget(key);
    if (next.current !== null && next.current !== state.current) {
      editor.current?.switchTo(next.current, next.files.get(next.current)!.text);
    }
    applyFiles({ type: "deleted", path });
  }

  async function importDropped(sources: string[], dir: string) {
    if (readOnly) return;
    try {
      const result = await importFiles(sources, dir, "ask");
      if (result.conflicts.length) {
        const n = result.conflicts.length;
        const choice = await ask("Files already exist", `${n} ${n === 1 ? "file already exists" : "files already exist"}.`, [
          { label: "Skip", value: "skip" },
          { label: "Keep both", value: "keepBoth" },
          { label: "Replace", value: "replace", primary: true },
        ]);
        if (choice) await importFiles(result.conflicts, dir, choice);
      }
      setTreeVersion((v) => v + 1);
    } catch (error) {
      setNotice(`Could not copy the files. ${errorText(error)}`);
    }
  }

  // ----- outside changes (research R3) -----

  async function onDiskChange(paths: string[]) {
    diskVersion.current++;
    void refreshGit();
    setTreeVersion((v) => v + 1);
    const state = filesRef.current;
    for (const changed of paths) {
      const key = keyOf(state, changed);
      if (key === undefined) continue;
      const file = state.files.get(key)!;
      if (isDirty(file)) {
        applyFiles({ type: "diskChanged", path: key });
        continue;
      }
      try {
        const text = await readFile(key);
        if (text === file.text) continue;
        if (key !== filesRef.current.current) editor.current?.forget(key);
        applyFiles({ type: "reloaded", path: key, text });
      } catch (error) {
        if (isProjectError(error, "notFound")) forgetUnder(key);
      }
    }
  }

  async function reloadCurrent() {
    const path = filesRef.current.current;
    if (path === null) return;
    try {
      applyFiles({ type: "reloaded", path, text: await readFile(path) });
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const keep = (dispose: () => void) => (disposed ? dispose() : unlisteners.push(dispose));
    try {
      listen<{ paths: string[] }>("project-changed", (event) => void onDiskChangeRef.current(event.payload.paths)).then(keep, () => undefined);
      listen("project-missing", () => setMissing(true)).then(keep, () => undefined);
    } catch {
      // Not running inside Tauri.
    }
    return () => {
      disposed = true;
      unlisteners.forEach((dispose) => dispose());
    };
  }, []);
  const onDiskChangeRef = useRef(onDiskChange);
  onDiskChangeRef.current = onDiskChange;

  async function saveAsNewProject() {
    const name = await prompt("Save as new project", "Project name", project.name);
    if (!name) return;
    try {
      const created = await createProject(name, filesRef.current.files.get(filesRef.current.main ?? "")?.text ?? STARTER_DOCUMENT);
      onSwitch(created);
    } catch (error) {
      setNotice(`Could not create the project. ${errorText(error)}`);
    }
  }

  // ----- editing -----

  function edit(change: (text: string, selection: { from: number; to: number }) => TextEdit) {
    const handle = editor.current;
    if (!handle || filesRef.current.current === null) return;
    handle.apply(change(handle.getText(), handle.getSelection()));
  }

  /** Document settings always live in the main document (FR-017), whichever file is shown. */
  function changeSettings(next: DocumentSettings) {
    const target = filesRef.current.main;
    const text = target !== null ? filesRef.current.files.get(keyOf(filesRef.current, target) ?? target)?.text : undefined;
    if (target === null || text === undefined) {
      setNotice("Open the main document first. Lexy keeps page and font settings there.");
      return;
    }
    try {
      const updated = applySettings(text, next);
      if (updated === null) {
        setNotice("Add a \\documentclass line first. Lexy keeps page and font settings right after it.");
        return;
      }
      const clashes = conflicts(text);
      if (clashes.length && !conflictWarned.current) {
        conflictWarned.current = true;
        setNotice(`This document already sets fonts or margins itself (${clashes[0]}). Lexy's settings may conflict with it.`);
      }
      const key = keyOf(filesRef.current, target)!;
      if (key === filesRef.current.current) {
        editor.current?.replaceAll(updated);
        return;
      }
      const result = editor.current?.applyTo(key, { from: 0, to: text.length, insert: updated, selectFrom: 0, selectTo: 0 }) ?? null;
      if (result === null) editor.current?.forget(key);
      applyFiles({ type: "edited", path: key, text: result ?? updated });
      afterEdit();
      setInfo(`Applied to ${baseName(key)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function afterEdit() {
    dispatch({ type: "edit" });
    live.current?.edit(String(++editSeq.current));
  }

  function insertEquation(result: EquationResult, target: EquationTarget) {
    const found = target.found;
    const latex = wrapEquation(result.tex, result.mode, found?.mode === result.mode ? found.delimiter : undefined);
    edit((text, selection) => {
      if (found) return replaceWith({ from: found.from, to: found.to }, latex);
      return result.mode === "display" ? insertBlock(text, selection, latex) : replaceWith(selection, latex);
    });
  }

  function insertTable(spec: TableSpec) {
    const { latex, cursor } = tableLatex(spec);
    edit((text, selection) => insertBlock(text, selection, latex, cursor));
  }

  function toggleFiles() {
    setFilesOpen((open) => {
      writeStorage(FILES_KEY, open ? "0" : "1");
      return !open;
    });
  }

  const actions: RibbonActions = {
    onNew: () => void newFile(current ? parentOf(current) : ""),
    onNewProject: () => void newProject(),
    onOpen: () => void openFolder(),
    onHome: () => void leave(null),
    onRecent: (path) => void leave(path),
    onSave: () => void saveAll(),
    onSaveAs: () => void saveCurrentAs(),
    onCompile: () => void runCompile(),
    onToggleLogs: () => setLogsOpen((open) => !open),
    onShowInPdf: () => void showInPdf(),
    onZoom: (kind) => (kind === "in" ? pdfView.current?.zoomIn() : kind === "out" ? pdfView.current?.zoomOut() : pdfView.current?.fit()),
    onToggleLive: () => setLiveEnabled((on) => !on && !readOnly),
    onToggleFiles: toggleFiles,
    onFormat: (command) => edit((text, selection) => wrap(text, selection, command)),
    onList: (kind) => edit((text, selection) => toList(text, selection, kind)),
    onHeading: (level) => edit((text, selection) => setHeading(text, selection, level)),
    onPageBreak: () => edit(pageBreak),
    onFootnote: () => edit(footnote),
    onEquation: () => {
      const handle = editor.current;
      const found = handle ? findEquationAt(handle.getText(), handle.getSelection().from) : null;
      setEquation({ found });
    },
    onTable: insertTable,
    onFont: (font: FontChoice) => changeSettings({ ...settings, font }),
    onSize: (size: FontSize) => changeSettings({ ...settings, size }),
    onLayout: changeSettings,
    onGit,
  };
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    // Capture phase so these win over the editor's own bindings (Ctrl+L select line, Ctrl+I select parent).
    function onKeyDown(event: KeyboardEvent) {
      if ((event.target as HTMLElement | null)?.closest?.(".dialog")) return;
      const key = event.key.toLowerCase();
      const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
      const run = actionsRef.current;
      let action: (() => void) | null = null;
      if (event.key === "F5" && !event.ctrlKey) action = run.onCompile;
      else if (ctrl && key === "s") action = event.shiftKey ? run.onSaveAs : run.onSave;
      else if (ctrl && event.shiftKey && key === "e") action = run.onToggleFiles;
      else if (ctrl && event.shiftKey && key === "g") action = () => run.onGit("changes");
      else if (ctrl && event.shiftKey && key === "k") action = () => run.onGit("focus");
      else if (ctrl && !event.shiftKey) {
        action =
          { n: run.onNew, o: run.onOpen, l: run.onToggleLogs, j: run.onShowInPdf, b: () => run.onFormat("textbf"), i: () => run.onFormat("textit"), u: () => run.onFormat("underline") }[key] ??
          null;
      }
      if (!action) return;
      // Formatting shortcuts only apply while typing in the editor, not inside dialogs.
      if (["b", "i", "u"].includes(key) && !event.shiftKey && !(event.target as HTMLElement | null)?.closest?.(".editor")) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const settleRef = useRef(settleUnsaved);
  settleRef.current = settleUnsaved;
  const exportRef = useRef(exportPdfOnExit);
  exportRef.current = exportPdfOnExit;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    try {
      getCurrentWindow()
        .onCloseRequested(async (event) => {
          // Window close keeps lastOpen, so this project reopens next time.
          if (!(await settleRef.current())) {
            event.preventDefault();
            return;
          }
          try {
            await exportRef.current();
          } catch (error) {
            // Stay open once so the user learns the PDF wasn't written; closing again quits.
            if (!exportWarned.current) {
              exportWarned.current = true;
              event.preventDefault();
              setNotice(`Lexy couldn't save the PDF next to your document: ${errorText(error)}. Close again to quit without it.`);
            }
          }
        })
        .then((dispose) => (disposed ? dispose() : (unlisten = dispose)));
    } catch {
      // Not running inside Tauri (browser preview); there is no window to guard.
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!info) return;
    const timer = setTimeout(() => setInfo(null), 2500);
    return () => clearTimeout(timer);
  }, [info]);

  function splitFromPointer(clientX: number) {
    const box = panes.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setSplit(clampSplit((clientX - box.left) / box.width));
  }

  function updateSplit(ratio: number) {
    const next = clampSplit(ratio);
    setSplit(next);
    writeStorage(SPLIT_KEY, String(next));
  }

  function updateSidebar(width: number) {
    const next = clampSidebar(width);
    setSidebarWidth(next);
    writeStorage(SIDEBAR_KEY, String(next));
  }

  const compiling = state.status === "compiling";
  const currentName = current ?? "No file open";

  return (
    <main className="writer">
      <Ribbon
        actions={actions}
        state={{
          fileName: currentName,
          path: current ? absolutePath(project.root, current) : null,
          unsaved: isDirty(currentFile),
          isMain: sameRel(current, main),
          projectName: project.name,
          mainName: main,
          statusLabel: statusLabel(state),
          statusClass: state.status,
          statusDetail: statusDetail(state),
          compiling: state.explicitBusy,
          readOnly,
          logsOpen,
          liveEnabled,
          filesOpen,
          recent: recent.filter((item) => !item.missing && !sameRel(item.path, project.root)).slice(0, 10),
          settings,
          settingsManaged,
          git,
          gitOpen,
          zoomLabel: zoomLabel(zoom),
        }}
      />

      {readOnly ? (
        <div className="notice info" role="status">
          <span>Open in another Lexy window. Read-only.</span>
        </div>
      ) : null}
      {missing ? (
        <div className="notice" role="alert">
          <span>Project folder is missing.</span>
          <button type="button" onClick={() => void saveAsNewProject()}>
            Save as new project
          </button>
        </div>
      ) : null}
      {currentFile?.diskChanged ? (
        <div className="notice" role="alert">
          <span>{baseName(current!)} changed on disk.</span>
          <span className="notice-actions">
            <button type="button" onClick={() => void reloadCurrent()}>
              Reload
            </button>
            <button type="button" onClick={() => applyFiles({ type: "keptMine", path: current! })}>
              Keep mine
            </button>
          </span>
        </div>
      ) : null}
      {notice ? (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {info ? (
        <div className="notice info" role="status">
          <span>{info}</span>
        </div>
      ) : null}

      <div
        className="workspace"
        style={{
          gridTemplateColumns: `${filesOpen ? `${sidebarWidth}px 4px ` : ""}minmax(0, 1fr)${gitOpen ? " var(--git-panel-width)" : ""}`,
        }}
        onPointerMove={(event) => {
          if (dragging.current === "sidebar") updateSidebar(event.clientX - event.currentTarget.getBoundingClientRect().left);
        }}
        onPointerUp={() => {
          if (dragging.current === "sidebar") dragging.current = null;
        }}
      >
        {filesOpen ? (
          <>
            <Sidebar
              projectName={project.name}
              version={treeVersion}
              current={current}
              main={main}
              dirty={dirtySet}
              changes={gitChanges}
              readOnly={readOnly}
              actions={{
                onOpen: onEntryOpen,
                onNewFile: (dir) => void newFile(dir),
                onNewFolder: (dir) => void newFolder(dir),
                onRename: rename,
                onDelete: (entry) => void remove(entry),
                onSetMain: (path) => void setMain(path),
                onReveal: (dir) => void openEntryExternal(dir).catch((error) => setNotice(errorText(error))),
                onHome: () => void leave(null),
                onImport: (sources, dir) => void importDropped(sources, dir),
                onError: setNotice,
              }}
            />
            <div
              className="splitter sidebar-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize file list"
              aria-valuemin={MIN_SIDEBAR}
              aria-valuemax={MAX_SIDEBAR}
              aria-valuenow={sidebarWidth}
              tabIndex={0}
              onPointerDown={(event) => {
                dragging.current = "sidebar";
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (dragging.current === "sidebar") {
                  const box = event.currentTarget.parentElement?.getBoundingClientRect();
                  if (box) updateSidebar(event.clientX - box.left);
                }
              }}
              onPointerUp={() => (dragging.current = null)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") updateSidebar(sidebarWidth - 20);
                else if (event.key === "ArrowRight") updateSidebar(sidebarWidth + 20);
                else return;
                event.preventDefault();
              }}
            />
          </>
        ) : null}

        <div
          className="panes"
          ref={panes}
          style={{ gridTemplateColumns: `minmax(0, ${split}fr) 6px minmax(0, ${1 - split}fr)` }}
        >
          <Editor
            handle={editor}
            value={currentFile?.text ?? ""}
            label="LaTeX source"
            onChange={(next) => {
              const path = filesRef.current.current;
              if (path === null) return;
              applyFiles({ type: "edited", path, text: next });
              afterEdit();
            }}
          />
          <div
            className="splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize editor and preview"
            aria-valuemin={MIN_SPLIT * 100}
            aria-valuemax={MAX_SPLIT * 100}
            aria-valuenow={Math.round(split * 100)}
            tabIndex={0}
            title="Drag to resize. Double-click to reset."
            onPointerDown={(event) => {
              dragging.current = "split";
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (dragging.current === "split") splitFromPointer(event.clientX);
            }}
            onPointerUp={() => {
              dragging.current = null;
              writeStorage(SPLIT_KEY, String(split));
            }}
            onDoubleClick={() => updateSplit(0.5)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") updateSplit(split - 0.05);
              else if (event.key === "ArrowRight") updateSplit(split + 0.05);
              else return;
              event.preventDefault();
            }}
          />
          <section className="preview" aria-label="PDF preview">
            {state.status === "error" ? (
              <div className="preview-banner">
                <span>{state.origin === "live" ? `Preview failed: ${state.summary}` : "Compile failed. Open log."}</span>
                {pdfBytes ? <span className="preview-stale">Preview is from the last successful compile.</span> : null}
                <button
                  type="button"
                  onClick={() => {
                    setDrawerTab("problems");
                    setLogsOpen(true);
                  }}
                >
                  Show problems
                </button>
              </div>
            ) : null}
            <PdfView
              handle={pdfView}
              bytes={pdfBytes}
              busy={compiling}
              onError={setNotice}
              onZoomChange={setZoom}
              onDoubleClickPoint={(page, x, y) => void showInSource(page, x, y)}
            />
          </section>
        </div>
        {gitOpen ? (
          <GitPanel
            state={git}
            projectName={project.name}
            request={gitRequest}
            refresh={refreshGit}
            saveAll={saveAll}
            confirmRestoreFile={confirmRestoreFile}
            reloadFiles={(paths) => onDiskChange(paths === "all" ? [...filesRef.current.files.keys()] : paths)}
            ask={ask}
            prompt={prompt}
            onClose={() => setGitOpen(false)}
          />
        ) : null}
      </div>

      {logsOpen ? (
        <section className="log-drawer" aria-label="Compile log">
          <div className="log-header">
            <div className="log-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={drawerTab === "problems"} onClick={() => setDrawerTab("problems")}>
                Problems ({problems.length})
              </button>
              <button type="button" role="tab" aria-selected={drawerTab === "log"} onClick={() => setDrawerTab("log")}>
                Log
              </button>
            </div>
            <strong>{state.summary ?? "No compile yet"}</strong>
            <button
              type="button"
              disabled={!state.log}
              onClick={() => void navigator.clipboard.writeText(state.log)}
            >
              Copy log
            </button>
          </div>
          {drawerTab === "log" ? <pre>{state.log || "No log yet"}</pre> : <Problems problems={problems} onJump={(file, line) => void jumpTo(file, line)} />}
        </section>
      ) : null}

      {mainChooser ? (
        <MainChooser candidates={mainChooser} onChoose={(path) => void setMain(path)} onCancel={() => setMainChooser(null)} />
      ) : null}

      {equation ? (
        <Suspense fallback={null}>
          <EquationDialog
            initialTex={equation.found?.tex}
            initialMode={equation.found?.mode}
            editing={!!equation.found}
            onClose={() => {
              setEquation(null);
              editor.current?.focus();
            }}
            onInsert={(result) => {
              const target = equation;
              setEquation(null);
              insertEquation(result, target);
            }}
          />
        </Suspense>
      ) : null}
      {choiceDialog}
      {nameDialog}
    </main>
  );
}


/** "Which file is the main document?" (contracts/ui.md). */
function MainChooser({ candidates, onChoose, onCancel }: { candidates: string[]; onChoose: (path: string) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState(candidates[0]);
  return (
    <Dialog
      title="Main document"
      onClose={onCancel}
      actions={
        <>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onChoose(picked)}>
            Use this
          </button>
        </>
      }
    >
      <fieldset className="main-choices">
        <legend>Which file is the main document?</legend>
        {candidates.map((path) => (
          <label key={path}>
            <input type="radio" name="main-document" checked={picked === path} onChange={() => setPicked(path)} />
            {path}
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}
