import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cancelCompile, converterStatus, exportDocument, exportPdf, exportPdfWithNotes, installBanglaFont, installConverter, type ConverterProgress, type ExportReport, loadPdf, syncToPdf, syncToSource, type CompileResult, type Problem } from "./compile";
import { addPurnoSetup, hasOutdatedPurnoSetup } from "./latex/scriptFont";
import { Editor, type EditorHandle } from "./Editor";
import { findEquationAt, wrapEquation, type FoundEquation } from "./latex/equations";
import { installKritiFont, type FontChoice } from "./latex/fonts";
import { footnote, insertBlock, pageBreak, replaceWith, setHeading, toList, wrap, type TextEdit } from "./latex/format";
import { applySettings, conflicts, hasSettingsBlock, parseSettings, replacesPdflatexLine, type DocumentSettings, type FontSize } from "./latex/settings";
import { engineEdit, readEngine, type EngineChoice } from "./latex/engine";
import { reasonLabel } from "./ribbon/EngineMenu";
import { tableLatex, type TableSpec } from "./latex/tables";
import { createLivePreview, type LivePreview } from "./livePreview";
import { dirtyFiles, emptyOpenFiles, isDirty, keyOf, openFilesReducer, type OpenFilesEvent } from "./openFiles";
import { gitLog, gitShowFile, gitStatus, STATUS_LETTER, type GitState } from "./git";
import { GitPanel, type GitAction } from "./GitPanel";
import { PdfView, type PdfViewHandle } from "./PdfView";
import { zoomLabel, type Zoom } from "./pdfView/zoom";
import { Problems } from "./Problems";
import { chooseProjectFolder, useChoice, useNamePrompt } from "./ProjectDialogs";
import {
  absolutePath,
  baseName,
  compileProject,
  copyEntry,
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
  listSnapshots,
  openEntryExternal,
  parentOf,
  projectTexts,
  readFile,
  readSnapshot,
  recoveryDiscard,
  recoveryList,
  recoverySave,
  renameEntry,
  sameRel,
  setMainDocument,
  writeFile,
  type Buffer,
  type Entry,
  type OpenedProject,
  type ProjectSummary,
  type RecoveryCopy,
} from "./projects";
import { createRecoveryScheduler, type RecoveryScheduler } from "./recovery";
import { RecoveryDialog } from "./RecoveryDialog";
import { Ribbon, type RibbonActions } from "./Ribbon";
import { buildIndex, type IndexCache, type ProjectIndex } from "./latex/index";
import { annotate } from "./latex/readable";
import { replaceIn, type SearchOptions } from "./latex/search";
import { appendEntry, bibliographySetup, insertCitation } from "./latex/citations";
import { ensureGraphicx, IMAGE_EXTENSIONS, insertFigure, isImage } from "./latex/figure";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CitationDialog } from "./ribbon/CitationDialog";
import { CompareView } from "./CompareView";
import { Notes } from "./Notes";
import { injectTodos, newNote, NOTES_PATH, parseNotes, reanchor, serializeNotes, withTodonotes, type Note } from "./latex/notes";
import { NewProjectDialog } from "./TemplateGallery";
import { SettingsDialog } from "./SettingsDialog";
import { InfoBar } from "./InfoBar";
import { DoiDialog } from "./ribbon/DoiDialog";
import { ribbonCommands, type Action } from "./actions";
import { CommandPalette } from "./CommandPalette";
import { EditorTabs } from "./EditorTabs";
import { Outline } from "./Outline";
import { ProjectSearch } from "./ProjectSearch";
import type { OutlineEntry } from "./latex/index";
import { countWords, projectWordCount, type WordCountCache } from "./latex/wordCount";
import { useSettings } from "./settings";
import { dictionaryAdd, fetchDoi, grammarCheck, spellCheck, spellSuggest } from "./writingAids";
import { Dialog } from "./ribbon/Dialog";
import type { EquationResult } from "./ribbon/EquationDialog";
import { Sidebar } from "./Sidebar";
import { STARTER_DOCUMENT } from "./starter";

const EquationDialog = lazy(() => import("./ribbon/EquationDialog"));

type Status = "idle" | "dirty" | "compiling" | "ready" | "error" | "stopped";
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
  /** Why that engine was used (spec 008 US3). */
  engineReason?: string | null;
};

/** The exit export's compile was stopped (spec 008 FR-016). */
class CompileStopped extends Error {}
const STOPPED_EXPORT = "The PDF was not updated: the compile was stopped.";

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
      // Stopped (spec 008 US2): the previous PDF, engine and log stay.
      if (event.result.stopped) return { ...state, status: explicitBusy ? "compiling" : "stopped", origin: event.origin, explicitBusy };
      return {
        status: explicitBusy ? "compiling" : event.result.ok ? "ready" : "error",
        summary: event.result.summary,
        log: event.result.log,
        pdfPath: event.result.pdfPath,
        origin: event.origin,
        explicitBusy,
        engine: event.result.engine,
        engineReason: event.result.engineReason ?? null,
      };
    }
  }
}

export function statusLabel(state: CompileState): string {
  if (state.status === "error") return state.origin === "live" ? "Preview failed" : "Compile failed";
  return { idle: "Idle", dirty: "Changed", compiling: "Compiling", ready: "PDF ready", stopped: "Compile stopped" }[state.status];
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
  /** One-time offer to put a Bangla font into the project (Lexy compiles with Nirmala UI meanwhile). */
  const [banglaOffer, setBanglaOffer] = useState(false);
  const banglaDismissed = useRef(false);
  const banglaKey = `lexy.banglaFont:${project.root.toLowerCase()}`;
  const dragging = useRef<"split" | "sidebar" | null>(null);
  const editor = useRef<EditorHandle>(null);
  const live = useRef<LivePreview | null>(null);
  const conflictWarned = useRef(false);
  const { ask, dialog: choiceDialog } = useChoice();
  const { settings: appSettings, update: updateAppSettings } = useSettings();
  const [projectWords, setProjectWords] = useState<number | null>(null);
  const [selectionWords, setSelectionWords] = useState(0);
  const wordCache = useRef<WordCountCache>(new Map());
  const [sideTab, setSideTab] = useState<"files" | "outline" | "search" | "notes">("files");
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  /** Bumped whenever the index is rebuilt, so open search results refresh. */
  const [indexVersion, setIndexVersion] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  /** A file or folder chosen with Copy, for Paste (spec 007 US5). */
  const [copied, setCopied] = useState<string | null>(null);
  const [history, setHistory] = useState<{ file: string; kind: "commits" | "snapshots"; versions: Version[]; mode: "restore" | "compare" } | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [compare, setCompare] = useState<{ file: string; against: string; before: string; after: string } | null>(null);
  const [citation, setCitation] = useState<"cite" | "doi" | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportState, setExportState] = useState<{ kind: "progress"; text: string } | { kind: "done"; report: ExportReport; folder: string } | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
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
  /** A compile is running (read by the Shift+F5 handler and the palette). */
  const compilingRef = useRef(false);
  const editSeq = useRef(0);
  /** Crash recovery (spec 008 US1): unsaved text is copied outside the project. */
  const recovery = useRef<RecoveryScheduler | null>(null);
  const [recovered, setRecovered] = useState<RecoveryCopy[]>([]);
  const recoveredRef = useRef(recovered);
  recoveredRef.current = recovered;
  const [recoveryReview, setRecoveryReview] = useState(false);
  const [recoveryFailed, setRecoveryFailed] = useState(false);

  const current = files.current;
  const currentFile = current !== null ? files.files.get(current) : undefined;
  const main = files.main;
  const mainText = main !== null ? (files.files.get(keyOf(files, main) ?? main)?.text ?? null) : null;

  // Lexy owns its marked Bangla block: an older version (no Script=Bengali, broken conjuncts)
  // is updated in place once, as one undo step.
  useEffect(() => {
    if (readOnly || mainText === null || main === null || !hasOutdatedPurnoSetup(mainText)) return;
    const key = keyOf(filesRef.current, main);
    const updated = addPurnoSetup(mainText);
    if (key === undefined || updated === null) return;
    replaceMainText(key, mainText, updated);
    setInfo("Updated Lexy's Bangla font block so conjuncts render correctly.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainText]);
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

  // Project text and index (spec 007 R1): disk text from `project_texts`, overlaid with every open
  // file's text, so suggestions, outline and search see unsaved edits.
  const diskTexts = useRef(new Map<string, string>());
  const indexCache = useRef<IndexCache>(new Map());
  /** Latest index; read through `projectIndex.current` so suggestions never wait for a render. */
  const projectIndex = useRef<ProjectIndex>(buildIndex(new Map(), null));
  const [textsVersion, setTextsVersion] = useState(0);
  useEffect(() => {
    // shortcut: reloads every text file after any tree change; switch to `project_texts(paths)` if large projects feel slow.
    const timer = setTimeout(() => {
      projectTexts().then(
        (result) => {
          diskTexts.current = new Map((result?.files ?? []).map((file) => [file.path, file.text]));
          setTextsVersion((v) => v + 1);
        },
        () => undefined,
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [treeVersion]);
  /** Every project text file, with each open file's current (possibly unsaved) text. */
  function currentTexts(): Map<string, string> {
    const texts = new Map(diskTexts.current);
    const byLower = new Map([...texts.keys()].map((path) => [path.toLowerCase(), path]));
    for (const [path, file] of filesRef.current.files) {
      const existing = byLower.get(path.toLowerCase());
      if (existing !== undefined) texts.delete(existing);
      texts.set(path, file.text);
    }
    return texts;
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      const texts = currentTexts();
      projectIndex.current = buildIndex(texts, filesRef.current.main, indexCache.current);
      const files = projectIndex.current.documentFiles;
      setProjectWords(files.length ? projectWordCount(files, texts, wordCache.current) : null);
      setOutline(projectIndex.current.outline);
      setIndexVersion((v) => v + 1);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textsVersion, files]);

  const spellLang = appSettings.spellLanguage;
  const editorAids = useMemo(
    () => ({
      getIndex: () => projectIndex.current,
      spellCheck: appSettings.spellCheck,
      vim: appSettings.vim,
      checkWords: (words: string[]) => spellCheck(spellLang, words),
      suggest: (word: string) => spellSuggest(spellLang, word),
      addWord: (word: string) => dictionaryAdd(word),
    }),
    [appSettings.spellCheck, appSettings.vim, spellLang],
  );
  const wordCountLabel =
    projectWords === null
      ? null
      : selectionWords > 0
        ? `${selectionWords.toLocaleString()} of ${projectWords.toLocaleString()} words`
        : `${projectWords.toLocaleString()} ${projectWords === 1 ? "word" : "words"}`;

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
    if (final.stopped) return;
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
    if (result.autoFont && !readOnly && !banglaDismissed.current && readStorage(banglaKey) === null) setBanglaOffer(true);
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
      if (result.stopped) throw new CompileStopped();
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
    scheduler.setDelay(appSettings.livePreviewDelayMs);
    live.current = scheduler;
    return () => scheduler.dispose();
    // Created once; edits and toggles are pushed into it below.
  }, []);
  useEffect(() => live.current?.setDelay(appSettings.livePreviewDelayMs), [appSettings.livePreviewDelayMs]);

  useEffect(() => {
    live.current?.setEnabled(liveEnabled);
    if (!readOnly) writeStorage(LIVE_KEY, liveEnabled ? "1" : "0");
  }, [liveEnabled]);

  // Crash recovery: keep unsaved text outside the project; never in read-only windows.
  useEffect(() => {
    if (readOnly) return;
    const scheduler = createRecoveryScheduler({
      save: recoverySave,
      discard: recoveryDiscard,
      onError: () => setRecoveryFailed(true),
    });
    recovery.current = scheduler;
    void recoveryList().then((copies) => {
      // Files restored or opened meanwhile keep their own text; offer the rest.
      setRecovered(copies);
    }, () => undefined);
    return () => scheduler.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    recovery.current?.changed([...files.files].map(([path, file]) => ({ path, text: file.text, dirty: isDirty(file) })));
  }, [files]);

  /** A clean close (Save all or Don't save): the session's recovery copies are no longer needed. */
  function finishRecovery() {
    if (readOnly) return;
    recovery.current?.dispose();
    // Copies the user hasn't decided on yet stay offered next time; everything else goes.
    const undecided = new Set(recoveredRef.current.map((copy) => copy.path.toLowerCase()));
    if (!undecided.size) void recoveryDiscard(null).catch(() => undefined);
    else {
      const session = [...filesRef.current.files.keys()].filter((path) => !undecided.has(path.split("\\").join("/").toLowerCase()));
      if (session.length) void recoveryDiscard(session).catch(() => undefined);
    }
  }

  /** Put recovered text into its file as an unsaved change (one undo step back to the disk text). */
  async function restoreRecovered(copy: RecoveryCopy) {
    const path = copy.path.split("/").join("\\");
    try {
      let key = keyOf(filesRef.current, path);
      if (key === undefined && copy.missing) {
        editor.current?.switchTo(path, "");
        applyFiles({ type: "opened", path, text: "" });
        key = path;
      } else if (!sameRel(path, filesRef.current.current)) {
        await openFile(path);
        key = keyOf(filesRef.current, path);
      }
      if (key === undefined) return;
      replaceMainText(key, filesRef.current.files.get(key)!.text, copy.text);
      setRecovered((list) => list.filter((item) => item.path !== copy.path));
      const changed = copy.diskChanged && !copy.missing ? " This file changed on disk since." : "";
      setInfo(`Restored unsaved text in ${baseName(path)}. Press Ctrl+Z to undo, Ctrl+S to keep it.${changed}`);
    } catch (error) {
      setNotice(`Could not restore ${baseName(path)}. ${errorText(error)}`);
    }
  }

  function discardRecovered(copies: RecoveryCopy[]) {
    const paths = new Set(copies.map((copy) => copy.path));
    setRecovered((list) => list.filter((item) => !paths.has(item.path)));
    void recoveryDiscard([...paths]).catch(() => undefined);
  }

  async function restoreAllRecovered() {
    setRecoveryReview(false);
    for (const copy of recovered) await restoreRecovered(copy);
  }

  async function discardAllRecovered() {
    const count = recovered.length;
    const choice = await ask("Discard unsaved text", `Discard unsaved text in ${count} ${count === 1 ? "file" : "files"}? This can't be undone.`, [
      { label: "Cancel", value: "cancel" },
      { label: "Discard", value: "discard", primary: true, destructive: true },
    ]);
    if (choice !== "discard") return;
    setRecoveryReview(false);
    discardRecovered(recovered);
  }

  // Open the main document (or ask which one it is).
  useEffect(() => {
    if (project.mainDocument) void openFile(project.mainDocument, { first: true });
    else if (project.candidates.length) setMainChooser(project.candidates);
    else setNotice("No main document found. Pick a .tex file in the sidebar and choose Set as main document.");
    void listProjects().then(setRecent, () => undefined);
  }, []);

  /** Show a text file; loads it from disk the first time. */
  async function openFile(path: string, { first = false } = {}) {
    pullNotes(); // keep the outgoing file's note positions before its state is put away
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
    // Notes store where their text is as of this save.
    if (notesRef.current.length) void persistNotes(pullNotes());
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

  /** Stop (spec 008 US2): drop live preview's queue, then end the running compile. */
  function stopCompile() {
    live.current?.cancel();
    void cancelCompile().catch(() => undefined);
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
    finishRecovery();
    try {
      await exportPdfOnExit();
    } catch (error) {
      setNotice(error instanceof CompileStopped ? STOPPED_EXPORT : `Lexy couldn't save the PDF next to your document: ${errorText(error)}`);
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

  /** File → New project: name and template come from the dialog (spec 007 US3). */
  async function createFromTemplate(name: string, starter: string) {
    setNewProjectOpen(false);
    try {
      await leave(await createProject(name, starter));
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
          { label: "Delete permanently", value: "delete", primary: true, destructive: true },
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
      const shown = key === filesRef.current.current;
      replaceMainText(key, text, updated);
      if (replacesPdflatexLine(text, next)) setInfo("This font needs XeLaTeX, so Lexy changed the engine line from pdfLaTeX to XeLaTeX.");
      else if (!shown) setInfo(`Applied to ${baseName(key)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  /** Layout → Engine (spec 008 US3): edit the main document's engine line as one undo step. */
  async function changeEngine(choice: EngineChoice) {
    if (readOnly) return;
    const target = filesRef.current.main;
    const key = target !== null ? keyOf(filesRef.current, target) : undefined;
    const text = key !== undefined ? filesRef.current.files.get(key)?.text : undefined;
    if (key === undefined || text === undefined) {
      setNotice("Open the main document first. Lexy keeps the engine line there.");
      return;
    }
    if (choice === "pdflatex" && parseSettings(text).font.kind !== "builtin") {
      const answer = await ask("Use pdfLaTeX?", "This font needs XeLaTeX or LuaLaTeX. Use pdfLaTeX anyway?", [
        { label: "Cancel", value: "cancel" },
        { label: "Use pdfLaTeX", value: "use", primary: true, destructive: true },
      ]);
      if (answer !== "use") return;
    }
    const edit = engineEdit(text, choice);
    if (!edit) return;
    if (key === filesRef.current.current) editor.current?.apply(edit);
    else {
      const result = editor.current?.applyTo(key, edit) ?? null;
      if (result === null) editor.current?.forget(key);
      applyFiles({ type: "edited", path: key, text: result ?? text.slice(0, edit.from) + edit.insert + text.slice(edit.to) });
      afterEdit();
      setInfo(`Applied to ${baseName(key)}`);
    }
  }

  /** Copy BCC Purno into the project and add its setup block to the main document. */
  async function addBanglaFont() {
    setBanglaOffer(false);
    const target = filesRef.current.main;
    const key = target === null ? undefined : keyOf(filesRef.current, target);
    const text = key === undefined ? undefined : filesRef.current.files.get(key)?.text;
    if (target === null || key === undefined || text === undefined) {
      setNotice("Open the main document first.");
      return;
    }
    setInfo("Adding BCC Purno…");
    try {
      await installBanglaFont(target);
    } catch (error) {
      setNotice(`Could not add BCC Purno. ${errorText(error)}`);
      return;
    }
    writeStorage(banglaKey, "added");
    const updated = addPurnoSetup(text);
    if (updated !== null) replaceMainText(key, text, updated);
    setTreeVersion((v) => v + 1);
    setInfo("BCC Purno added to fonts. The document now compiles anywhere with XeLaTeX.");
  }

  /** Replace the main document's text as one undo step, whether or not it is on screen. */
  // ----- content: citations and images (spec 007 US3) -----

  /** Load a file into the editor's kept states without showing it (for edits in other files). */
  async function loadInBackground(path: string): Promise<string> {
    const known = keyOf(filesRef.current, path);
    if (known !== undefined) return known;
    const text = await readFile(path);
    applyFiles({ type: "opened", path, text, background: true });
    editor.current?.preload(path, text);
    return path;
  }

  /** Change another (or the shown) file as one unsaved, undoable edit. */
  async function editFile(path: string, change: (text: string) => string) {
    const key = await loadInBackground(path);
    const text = filesRef.current.files.get(key)!.text;
    const next = change(text);
    if (next !== text) replaceMainText(key, text, next);
  }

  const applyEdit = (text: string, edit: TextEdit | null) => (edit ? text.slice(0, edit.from) + edit.insert + text.slice(edit.to) : text);

  function bibFiles(): string[] {
    return [...currentTexts().keys()].filter((path) => /\.bib$/i.test(path)).sort();
  }

  /** Create references.bib (if missing) and add the bibliography commands to the main document. */
  async function createBibliography(): Promise<string> {
    const path = "references.bib";
    try {
      await createFile(path);
    } catch (error) {
      if (!isProjectError(error, "nameTaken")) throw error;
    }
    const main = filesRef.current.main;
    if (main !== null) await editFile(main, (text) => applyEdit(text, bibliographySetup(text)));
    setTreeVersion((v) => v + 1);
    return path;
  }

  async function addBibEntry(entry: string, key: string, file: string | null) {
    setCitation(null);
    try {
      // Cite first, while the cursor is still where the user asked.
      edit((text, selection) => insertCitation(text, selection.from, [key]));
      await editFile(file ?? (await createBibliography()), (text) => appendEntry(text, entry));
      setInfo(`Added ${key} to ${file ?? "references.bib"}. Press Ctrl+S to save.`);
    } catch (error) {
      setNotice(`Could not add the entry. ${errorText(error)}`);
    }
  }

  /** Copy an image into the image folder (never overwriting), insert a figure, and load graphicx once. */
  async function insertImage(source: string, at: number | null = null) {
    if (readOnly || filesRef.current.current === null) return;
    const folder = appSettings.imageFolder;
    try {
      try {
        await createFolder(folder);
      } catch (error) {
        if (!isProjectError(error, "nameTaken")) throw error;
      }
      const result = await importFiles([source], folder, "keepBoth");
      const copied = result.copied[0];
      if (!copied) return;
      edit((text, selection) => insertFigure(text, at ?? selection.from, copied));
      const main = filesRef.current.main;
      if (main !== null) await editFile(main, (text) => applyEdit(text, ensureGraphicx(text)));
      setTreeVersion((v) => v + 1);
      setInfo(`Copied ${baseName(copied)} to ${folder}/`);
    } catch (error) {
      setNotice(`Could not insert the image. ${errorText(error)}`);
    }
  }

  async function pickImage() {
    try {
      const picked = await openDialog({ multiple: false, filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }] });
      if (typeof picked === "string") await insertImage(picked);
    } catch (error) {
      setNotice(`Could not choose an image. ${errorText(error)}`);
    }
  }

  // Files dropped on the editor: images become figures at the drop point, other files are imported.
  const dropRef = useRef<(paths: string[], x: number, y: number) => void>(() => undefined);
  dropRef.current = (paths, x, y) => {
    const scale = window.devicePixelRatio || 1;
    const element = document.elementFromPoint(x / scale, y / scale);
    if (!element?.closest(".editor")) return;
    const at = editor.current?.posAtCoords(x / scale, y / scale) ?? null;
    const images = paths.filter(isImage);
    const others = paths.filter((path) => !isImage(path));
    void (async () => {
      for (const image of images) await insertImage(image, at);
      if (others.length) await importDropped(others, "");
    })();
  };
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === "drop" && event.payload.paths.length) dropRef.current(event.payload.paths, event.payload.position.x, event.payload.position.y);
        }),
      )
      .then((dispose) => (disposed ? dispose() : (unlisten = dispose)))
      .catch(() => undefined); // Not running inside Tauri.
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // ----- files and safety (spec 007 US5) -----

  async function copyInto(from: string, dir: string) {
    try {
      const made = await copyEntry(from, dir);
      setTreeVersion((v) => v + 1);
      setInfo(`Created ${made}`);
    } catch (error) {
      setNotice(`Could not copy ${baseName(from)}. ${errorText(error)}`);
    }
  }

  /** Earlier versions of the shown file: Git history when the project has it, else Lexy's snapshots. */
  async function showHistory() {
    const file = filesRef.current.current;
    if (file === null) return;
    if (git?.repo === "own" || git?.repo === "parent") {
      onGit("history");
      return;
    }
    try {
      const { kind, versions } = await versionsOf(file);
      setHistory({ file, kind, versions, mode: "restore" });
    } catch (error) {
      setNotice(`Could not list earlier versions. ${errorText(error)}`);
    }
  }

  /** Restoring is an ordinary unsaved edit, so Ctrl+Z takes it back. */
  async function restoreSnapshot(file: string, time: number) {
    setHistory(null);
    try {
      const text = await readSnapshot(file, time);
      if (!sameRel(file, filesRef.current.current)) await openFile(file);
      const key = keyOf(filesRef.current, file);
      if (key === undefined) return;
      replaceMainText(key, filesRef.current.files.get(key)!.text, text);
      setInfo(`Restored the version from ${new Date(time).toLocaleString()}. Press Ctrl+Z to undo, Ctrl+S to keep it.`);
    } catch (error) {
      setNotice(`Could not restore that version. ${errorText(error)}`);
    }
  }

  // Auto-save (off by default): save every modified file once typing pauses; never in read-only windows.
  useEffect(() => {
    if (!appSettings.autoSave || readOnly || dirty.length === 0) return;
    const timer = setTimeout(() => void saveAll(), appSettings.autoSaveDelayMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, appSettings.autoSave, appSettings.autoSaveDelayMs, readOnly]);

  // ----- export to Word and HTML (spec 007 US7) -----

  /** Pandoc is installed on first use only after the user agrees; then the saved main document is converted. */
  async function exportAs(format: "docx" | "html") {
    const target = filesRef.current.main;
    if (target === null) {
      setNotice("Choose a main document first.");
      return;
    }
    try {
      const status = await converterStatus();
      if (!status.installed) {
        const megabytes = Math.round(status.downloadBytes / 1_000_000);
        const choice = await ask(
          "Download Pandoc?",
          `Export needs Pandoc, a free document converter (${megabytes} MB from github.com/jgm/pandoc). Lexy installs it for your Windows account only and checks the download before using it.`,
          [
            { label: "Cancel", value: "cancel" },
            { label: "Download", value: "download", primary: true },
          ],
        );
        if (choice !== "download") return;
        setExportState({ kind: "progress", text: "Downloading Pandoc" });
        let unlisten: (() => void) | undefined;
        try {
          unlisten = await listen<ConverterProgress>("converter-progress", ({ payload }) => {
            if (payload.state === "downloading" || payload.state === "unpacking") {
              const percent = payload.bytesTotal ? Math.round((payload.bytesDone / payload.bytesTotal) * 100) : 0;
              setExportState({ kind: "progress", text: `${payload.state === "downloading" ? "Downloading" : "Unpacking"} Pandoc… ${percent} %` });
            }
          });
        } catch {
          // Not running inside Tauri: no progress events.
        }
        try {
          await installConverter();
        } finally {
          unlisten?.();
        }
      }
      // Pandoc reads the file on disk, so unsaved edits are saved first.
      if (!(await saveAll()) && dirty.length) return;
      setExportState({ kind: "progress", text: `Exporting ${format === "docx" ? "Word document" : "web page"}…` });
      const report = await exportDocument(target, format);
      setExportState({ kind: "done", report, folder: parentOf(target) });
    } catch (error) {
      setExportState(null);
      setNotice(`Could not export. ${errorText(error)}`);
    }
  }

  // ----- review: notes and compare (spec 007 US4) -----

  const notesRef = useRef(notes);
  notesRef.current = notes;

  // Notes load once per project; a missing file just means no notes yet.
  useEffect(() => {
    readFile(NOTES_PATH).then(
      (json) => setNotes(parseNotes(json ?? "")),
      () => undefined,
    );
  }, []);

  /** The shown file's notes, updated with where their highlights are now (missing → detached). */
  function pullNotes(): Note[] {
    const shown = filesRef.current.current;
    const handle = editor.current;
    if (shown === null || !handle) return notesRef.current;
    const positions = new Map(handle.notePositions().map((mark) => [mark.id, mark]));
    const next = notesRef.current.map((note) => {
      if (!sameRel(note.file, shown) || note.state !== "open") return note;
      const mark = positions.get(note.id);
      return mark ? { ...note, from: mark.from, to: mark.to } : { ...note, state: "detached" as const };
    });
    if (next.some((note, index) => note !== notesRef.current[index])) {
      notesRef.current = next;
      setNotes(next);
    }
    return next;
  }

  async function persistNotes(next: Note[]) {
    notesRef.current = next;
    setNotes(next);
    if (readOnly) return;
    try {
      try {
        await createFolder(".lexy");
      } catch (error) {
        if (!isProjectError(error, "nameTaken")) throw error;
      }
      await writeFile(NOTES_PATH, serializeNotes(next));
    } catch (error) {
      setNotice(`Could not save the notes. ${errorText(error)}`);
    }
  }

  // Show the open notes of the shown file, re-found by their quoted text.
  useEffect(() => {
    if (current === null) return;
    const text = filesRef.current.files.get(current)?.text ?? "";
    const marks = notes
      .filter((note) => sameRel(note.file, current) && note.state === "open")
      .map((note) => reanchor(note, text))
      .filter((note) => note.state === "open")
      .map(({ id, from, to }) => ({ id, from, to }));
    editor.current?.setNotes(marks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, notes]);

  async function addNote() {
    const handle = editor.current;
    const file = filesRef.current.current;
    if (!handle || file === null || readOnly) return;
    const selection = handle.getSelection();
    if (selection.from === selection.to) {
      setInfo("Select the text the note is about, then press Ctrl+Alt+M.");
      return;
    }
    // Any text is fine in a note (the default prompt check is for file names, which forbid ? : * …).
    const body = await prompt("New note", "Note", "", (value) => (value.trim() ? null : "Write the note first."));
    if (!body?.trim()) return;
    await persistNotes([...pullNotes(), newNote(file, selection.from, selection.to, handle.getText(), body)]);
    setSideTab("notes");
  }

  async function jumpToNote(note: Note) {
    await openAt(note.file, note.from, note.to);
  }

  async function exportNotesPdf() {
    const target = filesRef.current.main;
    if (target === null) return;
    const all = pullNotes();
    if (!all.some((note) => note.state === "open")) {
      setInfo("There are no open notes to show in the PDF.");
      return;
    }
    // Copies of the main document and the files with notes; nothing is written to the project's .tex files.
    const texts = currentTexts();
    const files = new Set([target, ...all.filter((note) => note.state === "open").map((note) => note.file)]);
    const noted: Buffer[] = [];
    for (const file of files) {
      const key = [...texts.keys()].find((path) => sameRel(path, file));
      if (key === undefined) continue;
      let text = injectTodos(texts.get(key)!, all.filter((note) => sameRel(note.file, file)).map((note) => reanchor(note, texts.get(key)!)));
      if (sameRel(key, target)) text = withTodonotes(text);
      noted.push({ path: key, text });
    }
    // Other unsaved files too, so the PDF shows the same text as the preview.
    for (const buffer of buffers()) if (!noted.some((item) => sameRel(item.path, buffer.path))) noted.push(buffer);
    setInfo("Compiling the PDF with notes…");
    try {
      const name = await exportPdfWithNotes(target, noted);
      setInfo(`Saved ${name} beside the main document.`);
    } catch (error) {
      setInfo(null);
      setNotice(errorText(error));
    }
  }

  /** Versions of the shown file to compare with: Git commits when the project has Git, else snapshots. */
  async function versionsOf(file: string): Promise<{ kind: "commits" | "snapshots"; versions: Version[] }> {
    if (git?.repo === "own" || git?.repo === "parent") {
      const commits = await gitLog(0, 30);
      return {
        kind: "commits",
        versions: commits.map((commit) => ({ key: commit.id, label: commit.message, detail: new Date(commit.time * 1000).toLocaleString() })),
      };
    }
    const snapshots = await listSnapshots(file);
    return {
      kind: "snapshots",
      versions: snapshots.map((snapshot) => ({ key: String(snapshot.time), label: new Date(snapshot.time).toLocaleString(), detail: `${(snapshot.size / 1024).toFixed(1)} KB` })),
    };
  }

  async function compareWith(file: string, kind: "commits" | "snapshots", version: Version) {
    setHistory(null);
    try {
      const before = kind === "commits" ? await gitShowFile(version.key, file.split("\\").join("/")) : await readSnapshot(file, Number(version.key));
      const key = keyOf(filesRef.current, file);
      const after = key !== undefined ? filesRef.current.files.get(key)!.text : await readFile(file);
      setCompare({ file, against: kind === "commits" ? `“${version.label}” (${version.detail})` : `the version from ${version.label}`, before, after });
    } catch (error) {
      setNotice(`Could not compare. ${errorText(error)}`);
    }
  }

  async function compareLast() {
    const file = filesRef.current.current;
    if (file === null) return;
    try {
      const { kind, versions } = await versionsOf(file);
      if (!versions.length) {
        setInfo(kind === "commits" ? "No commits yet to compare with." : "No earlier version yet. Lexy keeps one when you save, at most every 10 minutes.");
        return;
      }
      await compareWith(file, kind, versions[0]);
    } catch (error) {
      setNotice(`Could not compare. ${errorText(error)}`);
    }
  }

  async function chooseComparison() {
    const file = filesRef.current.current;
    if (file === null) return;
    try {
      const { kind, versions } = await versionsOf(file);
      setHistory({ file, kind, versions, mode: "compare" });
    } catch (error) {
      setNotice(`Could not list earlier versions. ${errorText(error)}`);
    }
  }

  // ----- tabs, search, outline (spec 007 US2) -----

  /** Close a tab; unsaved edits get Save / Don't save / Cancel. The main document stays open. */
  async function closeTab(path: string) {
    const state = filesRef.current;
    const key = keyOf(state, path);
    if (key === undefined || sameRel(key, state.main)) return;
    const file = state.files.get(key)!;
    if (isDirty(file)) {
      const choice = await ask("Save changes?", `Save the changes to ${baseName(key)} before closing it?`, [
        { label: "Cancel", value: "cancel" },
        { label: "Don't save", value: "discard" },
        { label: "Save", value: "save", primary: true },
      ]);
      if (choice !== "save" && choice !== "discard") return;
      if (choice === "save") {
        try {
          await writeFile(key, file.text);
          diskVersion.current++;
        } catch (error) {
          setNotice(`Could not save ${baseName(key)}. ${errorText(error)}`);
          return;
        }
      }
    }
    const wasShown = key === filesRef.current.current;
    applyFiles({ type: "closed", path: key });
    const next = filesRef.current.current;
    // Switch first: switching stores the outgoing state, which forget then drops.
    if (wasShown && next !== null) editor.current?.switchTo(next, filesRef.current.files.get(next)!.text);
    editor.current?.forget(key);
    if (wasShown && next === null) editor.current?.focus();
    afterEdit();
  }

  function cycleTab(step: 1 | -1) {
    const order = [...filesRef.current.files.keys()];
    if (order.length < 2) return;
    const at = order.indexOf(filesRef.current.current ?? "");
    void openFile(order[(at + step + order.length) % order.length]);
  }

  function moveTab(step: 1 | -1) {
    const state = filesRef.current;
    if (state.current === null) return;
    const at = [...state.files.keys()].indexOf(state.current);
    applyFiles({ type: "reordered", path: state.current, index: at + step });
  }

  async function openAt(file: string, from: number, to: number) {
    const path = file.split("/").join("\\");
    if (!sameRel(path, filesRef.current.current)) await openFile(path);
    editor.current?.selectRange(from, to);
  }

  /** Replace in every file with matches: each file becomes one unsaved, undoable edit (never written to disk here). */
  async function replaceInProject(query: string, options: SearchOptions, replacement: string, targets: string[]) {
    if (readOnly) return;
    let changedFiles = 0;
    let total = 0;
    for (const target of targets) {
      let key = keyOf(filesRef.current, target);
      let text: string;
      if (key === undefined) {
        try {
          text = await readFile(target);
        } catch {
          continue;
        }
        applyFiles({ type: "opened", path: target, text, background: true });
        editor.current?.preload(target, text);
        key = target;
      } else {
        text = filesRef.current.files.get(key)!.text;
      }
      const result = replaceIn(text, query, options, replacement);
      if (!result.count) continue;
      replaceMainText(key, text, result.text);
      changedFiles++;
      total += result.count;
    }
    setInfo(`Replaced ${total} ${total === 1 ? "match" : "matches"} in ${changedFiles} ${changedFiles === 1 ? "file" : "files"}. Press Ctrl+S to save.`);
  }

  function showSide(tab: "files" | "outline" | "search" | "notes") {
    setSideTab(tab);
    if (!filesOpen) toggleFiles();
  }

  function replaceMainText(key: string, text: string, updated: string) {
    if (key === filesRef.current.current) {
      editor.current?.replaceAll(updated);
      return;
    }
    const result = editor.current?.applyTo(key, { from: 0, to: text.length, insert: updated, selectFrom: 0, selectTo: 0 }) ?? null;
    if (result === null) editor.current?.forget(key);
    applyFiles({ type: "edited", path: key, text: result ?? updated });
    afterEdit();
  }

  /** Built-in and installed fonts apply at once; a kriti.app family is copied into the project first. */
  async function chooseFont(font: FontChoice) {
    if (font.kind !== "kriti") {
      changeSettings({ ...settings, font });
      return;
    }
    const target = filesRef.current.main;
    if (target === null || readOnly) {
      setNotice("Open the main document first. Lexy keeps page and font settings there.");
      return;
    }
    setInfo(`Adding ${font.family} from kriti.app…`);
    try {
      const added = await installKritiFont(target, font.family);
      setTreeVersion((v) => v + 1);
      changeSettings({ ...settings, font: { kind: "project", ...added } });
      setInfo(`${font.family} copied to fonts and set as the document font.`);
    } catch (error) {
      setNotice(`Could not add ${font.family}. ${errorText(error)}`);
    }
  }

  /** On-demand grammar check of the shown file; the first use asks before any text leaves the machine (FR-024). */
  async function checkGrammar() {
    const handle = editor.current;
    if (!handle || current === null) return;
    if (!appSettings.grammarCheck) {
      const choice = await ask(
        "Check grammar online?",
        `The text of ${baseName(current)} is sent to ${appSettings.grammarServer} for checking. You can turn this off in Settings.`,
        [
          { label: "Cancel", value: "cancel" },
          { label: "Turn on", value: "on", primary: true },
        ],
      );
      if (choice !== "on") return;
      await updateAppSettings({ grammarCheck: true });
    }
    const text = handle.getText();
    setInfo("Checking grammar…");
    try {
      // Annotated parts cover the text in order, so LanguageTool's offsets are offsets in `text`.
      const issues = await grammarCheck(appSettings.grammarServer, appSettings.spellLanguage.replace("_", "-"), annotate(text));
      if (handle.getText() !== text) return; // Edited meanwhile: the offsets no longer fit.
      handle.setGrammar(issues.map((issue) => ({ from: issue.offset, to: issue.offset + issue.length, message: issue.message, replacements: issue.replacements })));
      setInfo(issues.length ? `${issues.length} grammar ${issues.length === 1 ? "suggestion" : "suggestions"}. Point at a wavy underline to see it.` : "No grammar issues found");
    } catch (error) {
      setInfo(null);
      setNotice(`Grammar check failed. ${errorText(error)}`);
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
    onNewProject: () => setNewProjectOpen(true),
    onOpen: () => void openFolder(),
    onHome: () => void leave(null),
    onRecent: (path) => void leave(path),
    onSave: () => void saveAll(),
    onSaveAs: () => void saveCurrentAs(),
    onCompile: () => void runCompile(),
    onEngine: (choice: EngineChoice) => void changeEngine(choice),
    onStop: stopCompile,
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
    onFont: (font: FontChoice) => void chooseFont(font),
    onSize: (size: FontSize) => changeSettings({ ...settings, size }),
    onLayout: changeSettings,
    onGit,
    onTidy: () => editor.current?.tidy(),
    onGrammar: () => void checkGrammar(),
    onToggleFocus: () => setFocusMode((on) => !on),
    onHistory: () => void showHistory(),
    onCitation: () => setCitation("cite"),
    onImage: () => void pickImage(),
    onNewNote: () => void addNote(),
    onShowNotes: () => showSide("notes"),
    onCompareLast: () => void compareLast(),
    onCompareWith: () => void chooseComparison(),
    onExportNotes: () => void exportNotesPdf(),
    onExport: (format) => void exportAs(format),
    onSettings: () => {
      setSettingsOpen(true);
      import("@tauri-apps/api/app").then(({ getVersion }) => getVersion()).then(setAppVersion, () => undefined);
    },
  };
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  /** Everything the command palette lists (spec 007 R12): the ribbon plus actions without a button. */
  const commands: Action[] = [
    ...ribbonCommands(actions),
    { id: "view.outline", group: "View", title: "Show outline", shortcut: "Ctrl+Shift+O", run: () => showSide("outline") },
    { id: "view.search", group: "View", title: "Find in project", shortcut: "Ctrl+Shift+F", run: () => showSide("search") },
    { id: "view.palette", group: "View", title: "Command palette", shortcut: "Ctrl+Shift+P", run: () => setPaletteOpen(true) },
    { id: "tabs.next", group: "Tabs", title: "Next tab", shortcut: "Ctrl+Tab", run: () => cycleTab(1) },
    { id: "tabs.previous", group: "Tabs", title: "Previous tab", shortcut: "Ctrl+Shift+Tab", run: () => cycleTab(-1) },
    { id: "tabs.close", group: "Tabs", title: "Close tab", shortcut: "Ctrl+W", run: () => current && void closeTab(current), enabled: () => !!current && !sameRel(current, main) },
    { id: "tabs.left", group: "Tabs", title: "Move tab left", shortcut: "Ctrl+Shift+PageUp", run: () => moveTab(-1) },
    { id: "tabs.right", group: "Tabs", title: "Move tab right", shortcut: "Ctrl+Shift+PageDown", run: () => moveTab(1) },
    {
      id: "settings.vim",
      group: "Settings",
      title: appSettings.vim ? "Turn off Vim keys" : "Turn on Vim keys",
      run: () => void updateAppSettings({ vim: !appSettings.vim }),
    },
    ...(readOnly
      ? []
      : (["auto", "pdflatex", "xelatex", "lualatex"] as const).map((choice) => ({
          id: `engine.${choice}`,
          group: "Layout",
          title: `Engine: ${{ auto: "Automatic", pdflatex: "pdfLaTeX", xelatex: "XeLaTeX", lualatex: "LuaLaTeX" }[choice]}`,
          run: () => void changeEngine(choice),
        }))),
    {
      id: "compile.stop",
      group: "Compile",
      title: "Stop compile",
      shortcut: "Shift+F5",
      enabled: () => compilingRef.current,
      run: stopCompile,
    },
    {
      id: "settings.autoSave",
      group: "Settings",
      title: appSettings.autoSave ? "Turn off auto-save" : "Turn on auto-save",
      run: () => void updateAppSettings({ autoSave: !appSettings.autoSave }),
    },
    {
      id: "settings.spell",
      group: "Settings",
      title: appSettings.spellCheck ? "Turn off spell check" : "Turn on spell check",
      run: () => void updateAppSettings({ spellCheck: !appSettings.spellCheck }),
    },
  ];
  /** F6 / Shift+F6: next / previous pane (Windows keyboard rule): ribbon → side panel → editor → PDF → drawer. */
  function cyclePane(step: 1 | -1) {
    const panes = [
      document.querySelector<HTMLElement>('.ribbon:not([hidden]) [role="tab"][aria-selected="true"]'),
      document.querySelector<HTMLElement>('.side-panel [role="tab"][aria-selected="true"]'),
      document.querySelector<HTMLElement>(".editor-column .cm-content"),
      document.querySelector<HTMLElement>(".preview"),
      document.querySelector<HTMLElement>('.log-drawer [role="tab"][aria-selected="true"]'),
    ].filter((pane): pane is HTMLElement => pane !== null);
    if (!panes.length) return;
    const regions = [".ribbon", ".side-panel", ".editor-column", ".preview", ".log-drawer"];
    const active = document.activeElement;
    const at = panes.findIndex((pane) => {
      const region = regions.find((selector) => pane.closest(selector));
      return region !== undefined && !!active?.closest(region);
    });
    const next = at < 0 ? (step === 1 ? 0 : panes.length - 1) : (at + step + panes.length) % panes.length;
    panes[next].focus();
  }

  const cyclePaneRef = useRef(cyclePane);
  cyclePaneRef.current = cyclePane;
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const runCommand = (id: string) => () => commandsRef.current.find((command) => command.id === id)?.run();

  useEffect(() => {
    // Capture phase so these win over the editor's own bindings (Ctrl+L select line, Ctrl+I select parent).
    function onKeyDown(event: KeyboardEvent) {
      if ((event.target as HTMLElement | null)?.closest?.(".dialog")) return;
      const key = event.key.toLowerCase();
      const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
      const run = actionsRef.current;
      let action: (() => void) | null = null;
      if (event.key === "F5" && event.shiftKey && !event.ctrlKey) action = compilingRef.current ? run.onStop : () => undefined;
      else if (event.key === "F5" && !event.ctrlKey) action = run.onCompile;
      else if (ctrl && key === "s") action = event.shiftKey ? run.onSaveAs : run.onSave;
      else if (ctrl && event.shiftKey && key === "e") action = run.onToggleFiles;
      else if (ctrl && event.shiftKey && key === "g") action = () => run.onGit("changes");
      else if (ctrl && event.shiftKey && key === "k") action = () => run.onGit("focus");
      else if (event.key === "F7" && !event.ctrlKey && !event.altKey) action = run.onGrammar;
      else if (event.key === "F11" && !event.ctrlKey && !event.altKey) action = runCommand("view.focus");
      else if (event.key === "F6" && !event.ctrlKey && !event.altKey) action = () => cyclePaneRef.current(event.shiftKey ? -1 : 1);
      else if (event.ctrlKey && event.altKey && !event.shiftKey && key === "m") action = run.onNewNote;
      else if (ctrl && !event.shiftKey && event.key === ",") action = run.onSettings;
      else if (event.ctrlKey && !event.altKey && event.key === "Tab") action = runCommand(event.shiftKey ? "tabs.previous" : "tabs.next");
      else if (event.ctrlKey && !event.altKey && event.key === "F4") action = runCommand("tabs.close");
      else if (ctrl && event.shiftKey && event.key === "PageUp") action = runCommand("tabs.left");
      else if (ctrl && event.shiftKey && event.key === "PageDown") action = runCommand("tabs.right");
      else if (ctrl && event.shiftKey && key === "p") action = runCommand("view.palette");
      else if (ctrl && event.shiftKey && key === "f") action = runCommand("view.search");
      else if (ctrl && event.shiftKey && key === "o") action = runCommand("view.outline");
      else if (ctrl && !event.shiftKey && key === "w") action = runCommand("tabs.close");
      else if (event.altKey && event.shiftKey && !event.ctrlKey && key === "f") action = run.onTidy;
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
  const finishRecoveryRef = useRef(finishRecovery);
  finishRecoveryRef.current = finishRecovery;
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
              setNotice(error instanceof CompileStopped ? `${STOPPED_EXPORT} Close again to quit without it.` : `Lexy couldn't save the PDF next to your document: ${errorText(error)}. Close again to quit without it.`);
              return;
            }
          }
          finishRecoveryRef.current();
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
  compilingRef.current = compiling;
  const currentName = current ?? "No file open";

  const hidePdf = focusMode && appSettings.hidePdfInFocus;
  const showSidebar = filesOpen && !focusMode;
  const tabPaths = [...files.files.keys()];

  return (
    <main className={focusMode ? "writer focus-mode" : "writer"}>
      {focusMode ? (
        <button type="button" className="leave-focus" onClick={() => setFocusMode(false)}>
          Leave focus mode (F11)
        </button>
      ) : null}
      <Ribbon
        hidden={focusMode}
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
          engine: readEngine(mainText ?? "").choice,
          lastEngine: state.engine ? `Last compile: ${ENGINE_NAMES[state.engine]} (${reasonLabel(state.engineReason ?? undefined)})` : null,
          stoppable: compiling && !readOnly,
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
          wordCount: wordCountLabel,
        }}
      />

      {readOnly ? <InfoBar severity="warning">Open in another Lexy window. Read-only.</InfoBar> : null}
      {missing ? (
        <InfoBar
          severity="error"
          actions={
            <button type="button" onClick={() => void saveAsNewProject()}>
              Save as new project
            </button>
          }
        >
          Project folder is missing.
        </InfoBar>
      ) : null}
      {currentFile?.diskChanged ? (
        <InfoBar
          severity="warning"
          actions={
            <>
              <button type="button" onClick={() => void reloadCurrent()}>
                Reload
              </button>
              <button type="button" onClick={() => applyFiles({ type: "keptMine", path: current! })}>
                Keep mine
              </button>
            </>
          }
        >
          {baseName(current!)} changed on disk.
        </InfoBar>
      ) : null}
      {banglaOffer ? (
        <InfoBar
          actions={
            <>
              <button type="button" className="primary" onClick={() => void addBanglaFont()}>
                Add font
              </button>
              <button
                type="button"
                onClick={() => {
                  banglaDismissed.current = true;
                  setBanglaOffer(false);
                }}
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => {
                  writeStorage(banglaKey, "never");
                  setBanglaOffer(false);
                }}
              >
                Don't ask again
              </button>
            </>
          }
        >
          Bangla text without a Bangla font: the preview uses Nirmala UI. Add BCC Purno (Bangladesh Computer Council, 0.8 MB) to this
          project so it compiles on any computer and on Overleaf (choose XeLaTeX there)?
        </InfoBar>
      ) : null}
      {notice ? (
        <InfoBar severity="error" onClose={() => setNotice(null)}>
          {notice}
        </InfoBar>
      ) : null}
      {exportState?.kind === "progress" ? <InfoBar>{exportState.text}</InfoBar> : null}
      {exportState?.kind === "done" ? (
        <InfoBar
          severity={exportState.report.warnings.length ? "warning" : "success"}
          onClose={() => setExportState(null)}
          actions={
            <>
              <button type="button" onClick={() => void openEntryExternal(joinRel(exportState.folder, exportState.report.output)).catch((error) => setNotice(errorText(error)))}>
                Open
              </button>
              {exportState.report.warnings.length ? (
                <button
                  type="button"
                  onClick={() =>
                    void ask("Approximated parts", <ul className="export-warnings">{exportState.report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>, [
                      { label: "Close", value: "close", primary: true },
                    ])
                  }
                >
                  Show details
                </button>
              ) : null}
            </>
          }
        >
          Exported {exportState.report.output}
          {exportState.report.warnings.length
            ? `. ${exportState.report.warnings.length} ${exportState.report.warnings.length === 1 ? "part was" : "parts were"} approximated.`
            : "."}
        </InfoBar>
      ) : null}
      {recovered.length && !readOnly ? (
        <InfoBar
          actions={
            <>
              <button type="button" className="primary" onClick={() => void restoreAllRecovered()}>
                Restore all
              </button>
              <button type="button" onClick={() => void discardAllRecovered()}>
                Discard all
              </button>
              <button type="button" onClick={() => setRecoveryReview(true)}>
                Review…
              </button>
            </>
          }
        >
          {`Lexy found unsaved text from your last session in ${recovered.length} ${recovered.length === 1 ? "file" : "files"}.`}
        </InfoBar>
      ) : null}
      {recoveryFailed ? (
        <InfoBar severity="warning" onClose={() => setRecoveryFailed(false)}>
          Lexy couldn't keep a recovery copy of your unsaved text. Save often.
        </InfoBar>
      ) : null}
      {recoveryReview ? (
        <RecoveryDialog
          copies={recovered}
          onRestore={(copy) => void restoreRecovered(copy)}
          onDiscard={(copy) => discardRecovered([copy])}
          onClose={() => setRecoveryReview(false)}
        />
      ) : null}
      {info ? <InfoBar>{info}</InfoBar> : null}

      <div
        className="workspace"
        style={{
          gridTemplateColumns: `${showSidebar ? `${sidebarWidth}px 4px ` : ""}minmax(0, 1fr)${gitOpen && !focusMode ? " var(--git-panel-width)" : ""}`,
        }}
        onPointerMove={(event) => {
          if (dragging.current === "sidebar") updateSidebar(event.clientX - event.currentTarget.getBoundingClientRect().left);
        }}
        onPointerUp={() => {
          if (dragging.current === "sidebar") dragging.current = null;
        }}
      >
        {showSidebar ? (
          <>
            <div className="side-panel">
              <div className="side-tabs" role="tablist" aria-label="Side panel">
                {(
                  [
                    ["files", "Files", "Ctrl+Shift+E"],
                    ["outline", "Outline", "Ctrl+Shift+O"],
                    ["search", "Search", "Ctrl+Shift+F"],
                    ["notes", "Notes", "Ctrl+Alt+M adds one"],
                  ] as const
                ).map(([id, label, shortcut]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`side-tab-${id}`}
                    aria-selected={sideTab === id}
                    aria-controls={`side-panel-${id}`}
                    tabIndex={sideTab === id ? 0 : -1}
                    title={`${label} (${shortcut})`}
                    onClick={() => setSideTab(id)}
                    onKeyDown={(event) => {
                      const order = ["files", "outline", "search", "notes"] as const;
                      const at = order.indexOf(id);
                      const to = event.key === "ArrowRight" ? order[(at + 1) % 4] : event.key === "ArrowLeft" ? order[(at + 3) % 4] : null;
                      if (!to) return;
                      event.preventDefault();
                      setSideTab(to);
                      document.getElementById(`side-tab-${to}`)?.focus();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="side-body" id="side-panel-outline" role="tabpanel" aria-labelledby="side-tab-outline" hidden={sideTab !== "outline"}>
                {sideTab === "outline" ? <Outline entries={outline} hasMain={main !== null} onJump={(file, line) => void jumpTo(file, line)} /> : null}
              </div>
              <div className="side-body" id="side-panel-search" role="tabpanel" aria-labelledby="side-tab-search" hidden={sideTab !== "search"}>
                {sideTab === "search" ? (
                  <ProjectSearch
                    getTexts={currentTexts}
                    readOnly={readOnly}
                    version={indexVersion}
                    onOpen={(file, from, to) => void openAt(file, from, to)}
                    onReplaceAll={(query, options, replacement, targets) => void replaceInProject(query, options, replacement, targets)}
                  />
                ) : null}
              </div>
              <div className="side-body" id="side-panel-notes" role="tabpanel" aria-labelledby="side-tab-notes" hidden={sideTab !== "notes"}>
                {sideTab === "notes" ? (
                  <Notes
                    notes={notes}
                    readOnly={readOnly}
                    onJump={(note) => void jumpToNote(note)}
                    onState={(note, state) => void persistNotes(pullNotes().map((item) => (item.id === note.id ? { ...item, state } : item)))}
                    onDelete={(note) => void persistNotes(pullNotes().filter((item) => item.id !== note.id))}
                  />
                ) : null}
              </div>
              <div className="side-body" id="side-panel-files" role="tabpanel" aria-labelledby="side-tab-files" hidden={sideTab !== "files"}>
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
                onDuplicate: (entry) => void copyInto(entry.path, parentOf(entry.path)),
                onCopy: (entry) => {
                  setCopied(entry.path);
                  setInfo(`Copied ${entry.name}. Right-click a folder and choose Paste.`);
                },
                onPaste: (dir) => copied !== null && void copyInto(copied, dir),
              }}
              canPaste={copied !== null}
            />
              </div>
            </div>
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
          style={{ gridTemplateColumns: hidePdf ? "minmax(0, 1fr)" : `minmax(0, ${split}fr) 6px minmax(0, ${1 - split}fr)` }}
        >
          <div className="editor-column">
          {focusMode ? null : (
            <EditorTabs
              paths={tabPaths}
              current={current}
              main={main}
              dirty={dirtySet}
              onSelect={(path) => void openFile(path)}
              onClose={(path) => void closeTab(path)}
              onMove={(path, index) => applyFiles({ type: "reordered", path, index })}
              onCloseOthers={(keep) => {
                void (async () => {
                  for (const path of [...filesRef.current.files.keys()]) if (!sameRel(path, keep)) await closeTab(path);
                })();
              }}
              onCopyPath={(path) => void navigator.clipboard?.writeText(absolutePath(project.root, path))}
              onReveal={() => showSide("files")}
            />
          )}
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
            aids={editorAids}
            onSelectionText={(text) => setSelectionWords(text ? countWords(text) : 0)}
          />
          {compare ? <CompareView {...compare} onClose={() => setCompare(null)} /> : null}
          </div>
          {hidePdf ? null : (
          <>
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
          <section className="preview" aria-label="PDF preview" tabIndex={-1}>
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
          </>
          )}
        </div>
        {gitOpen && !focusMode ? (
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

      {paletteOpen ? (
        <CommandPalette
          actions={commands}
          onClose={() => {
            setPaletteOpen(false);
            editor.current?.focus();
          }}
        />
      ) : null}

      {logsOpen && !focusMode ? (
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

      {citation === "cite" ? (
        <CitationDialog
          entries={projectIndex.current.bibEntries}
          hasBib={bibFiles().length > 0}
          onInsert={(keys) => {
            setCitation(null);
            edit((text, selection) => insertCitation(text, selection.from, keys));
          }}
          onAddByDoi={() => setCitation("doi")}
          onCreateBib={() => {
            setCitation(null);
            createBibliography().then(
              () => setInfo("Created references.bib. Add entries there or by DOI."),
              (error) => setNotice(`Could not create references.bib. ${errorText(error)}`),
            );
          }}
          onClose={() => setCitation(null)}
        />
      ) : null}
      {citation === "doi" ? (
        <DoiDialog
          bibFiles={bibFiles()}
          existingKeys={projectIndex.current.bibEntries.map((entry) => entry.key)}
          lookup={fetchDoi}
          onAdd={(entry, key, file) => void addBibEntry(entry, key, file)}
          onClose={() => setCitation(null)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsDialog settings={appSettings} update={updateAppSettings} version={appVersion} onClose={() => setSettingsOpen(false)} />
      ) : null}

      {newProjectOpen ? (
        <NewProjectDialog onCreate={(name, template) => void createFromTemplate(name, template.text)} onClose={() => setNewProjectOpen(false)} />
      ) : null}

      {history ? (
        <HistoryDialog
          file={history.file}
          versions={history.versions}
          readOnly={readOnly}
          onRestore={history.kind === "snapshots" ? (version) => void restoreSnapshot(history.file, Number(version.key)) : undefined}
          onCompare={(version) => void compareWith(history.file, history.kind, version)}
          onClose={() => setHistory(null)}
        />
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
type Version = { key: string; label: string; detail: string };

function MainChooser({ candidates, onChoose, onCancel }: { candidates: string[]; onChoose: (path: string) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState(candidates[0]);
  return (
    <Dialog
      title="Main document"
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="primary" onClick={() => onChoose(picked)}>
            Use this
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
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

/** Earlier versions of one file (Lexy's snapshots, or Git commits for Compare), spec 007 US4/US5. */
function HistoryDialog({
  file,
  versions,
  readOnly,
  onRestore,
  onCompare,
  onClose,
}: {
  file: string;
  versions: Version[];
  readOnly: boolean;
  onRestore?: (version: Version) => void;
  onCompare: (version: Version) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={`Earlier versions of ${baseName(file)}`}
      onClose={onClose}
      actions={
        <button type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      {versions.length ? (
        <ul className="history-list">
          {versions.map((version) => (
            <li key={version.key}>
              <span>{version.label}</span>
              <span className="history-size">{version.detail}</span>
              <button type="button" onClick={() => onCompare(version)}>
                Compare
              </button>
              {onRestore ? (
                <button type="button" disabled={readOnly} onClick={() => onRestore(version)}>
                  Restore
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>No earlier versions yet. Lexy keeps one when you save, at most every 10 minutes, for 30 days.</p>
      )}
    </Dialog>
  );
}
