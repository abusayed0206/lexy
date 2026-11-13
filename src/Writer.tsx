import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { compileSource, exportPdf, loadPdf, type CompileResult } from "./compile";
import {
  chooseOpenPath,
  chooseSavePath,
  confirmDiscard,
  defaultFolder,
  fileName,
  prepareSavePath,
  readDocument,
  suggestFileName,
  writeDocument,
} from "./documents";
import { Editor, type EditorHandle } from "./Editor";
import { findEquationAt, wrapEquation, type FoundEquation } from "./latex/equations";
import type { FontChoice } from "./latex/fonts";
import { footnote, insertBlock, pageBreak, replaceWith, setHeading, toList, wrap, type TextEdit } from "./latex/format";
import { applySettings, conflicts, hasSettingsBlock, parseSettings, type DocumentSettings, type FontSize } from "./latex/settings";
import { tableLatex, type TableSpec } from "./latex/tables";
import { createLivePreview, type LivePreview } from "./livePreview";
import { PdfView } from "./PdfView";
import { Ribbon, type RibbonActions } from "./Ribbon";
import type { EquationResult } from "./ribbon/EquationDialog";
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
};

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
const SPLIT_KEY = "lexy.split";
const LIVE_KEY = "lexy.livePreview";

export function clampSplit(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ratio));
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

type EquationTarget = { found: FoundEquation | null };

export function Writer() {
  const [path, setPath] = useState<string | null>(null);
  const [source, setSource] = useState(STARTER_DOCUMENT);
  const [savedSource, setSavedSource] = useState(STARTER_DOCUMENT);
  const [state, dispatch] = useReducer(compileReducer, initialState);
  const [logsOpen, setLogsOpen] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [split, setSplit] = useState(loadSplit);
  const [liveEnabled, setLiveEnabled] = useState(() => readStorage(LIVE_KEY) !== "0");
  const [equation, setEquation] = useState<EquationTarget | null>(null);
  const panes = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const editor = useRef<EditorHandle>(null);
  const live = useRef<LivePreview | null>(null);
  const conflictWarned = useRef(false);
  const folderWarned = useRef(false);

  const unsaved = source !== savedSource;
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const pathRef = useRef(path);
  pathRef.current = path;
  const savedRef = useRef(savedSource);
  savedRef.current = savedSource;
  /** The PDF in the build folder ("in memory") and exactly which text/document produced it. */
  const lastPdf = useRef<{ pdfPath: string; text: string; documentPath: string | null } | null>(null);
  const exportWarned = useRef(false);

  const settings = useMemo(() => parseSettings(source), [source]);
  const settingsManaged = useMemo(() => hasSettingsBlock(source), [source]);

  async function showResult(result: CompileResult, origin: Origin, text: string, documentPath: string | null) {
    let final = result;
    if (result.ok && result.pdfPath) {
      try {
        setPdfBytes(await loadPdf(result.pdfPath));
        lastPdf.current = { pdfPath: result.pdfPath, text, documentPath };
      } catch (error) {
        const message = String(error);
        final = { ...result, ok: false, summary: message, log: message, pdfPath: null };
      }
    }
    dispatch({ type: "done", origin, result: final });
    if (origin === "explicit" && !final.ok) setLogsOpen(true);
  }

  /**
   * On exit, write the PDF next to the saved .tex. It must match what is saved on disk,
   * so if the last preview was of other (unsaved or discarded) text, compile the saved text first.
   */
  async function exportPdfOnExit() {
    const documentPath = pathRef.current;
    if (!documentPath) return; // Untitled: there is no project folder to put it in.
    const saved = savedRef.current;
    let pdf = lastPdf.current;
    if (!pdf || pdf.text !== saved || pdf.documentPath !== documentPath) {
      const result = await compileSource(saved, documentPath);
      if (!result.ok || !result.pdfPath) throw new Error(`the saved document doesn't compile (${result.summary})`);
      pdf = { pdfPath: result.pdfPath, text: saved, documentPath };
    }
    await exportPdf(pdf.pdfPath, documentPath);
  }
  const exportRef = useRef(exportPdfOnExit);
  exportRef.current = exportPdfOnExit;

  // Live preview: compile a snapshot of the editor text ~1 s after typing stops (research R5).
  useEffect(() => {
    let compiledFor: string | null = null;
    const scheduler = createLivePreview({
      compile: (text) => {
        dispatch({ type: "start", origin: "live" });
        compiledFor = pathRef.current;
        return compileSource(text, compiledFor);
      },
      onResult: (result, text) => void showResult(result, "live", text, compiledFor),
    });
    scheduler.setEnabled(liveEnabled);
    live.current = scheduler;
    if (liveEnabled) scheduler.now(source);
    return () => scheduler.dispose();
    // Created once; text and toggles are pushed into it below.
  }, []);

  useEffect(() => {
    live.current?.setEnabled(liveEnabled);
    writeStorage(LIVE_KEY, liveEnabled ? "1" : "0");
  }, [liveEnabled]);

  function loadDocument(nextPath: string | null, text: string) {
    setPath(nextPath);
    pathRef.current = nextPath;
    setSource(text);
    setSavedSource(text);
    dispatch({ type: "reset" });
    setPdfBytes(null);
    setNotice(null);
    conflictWarned.current = false;
    if (liveEnabled) live.current?.now(text);
  }

  /** `<Documents>\Lexy`, with a one-time notice if Lexy had to fall back to the home folder. */
  async function startFolder(): Promise<string | null> {
    try {
      const folder = await defaultFolder();
      if (folder.fallback && !folderWarned.current) {
        folderWarned.current = true;
        setNotice(`Saving to ${folder.path} because Documents isn't available.`);
      }
      return folder.path;
    } catch {
      return null;
    }
  }

  async function newDocument() {
    if (unsavedRef.current && !(await confirmDiscard())) return;
    loadDocument(null, STARTER_DOCUMENT);
  }

  async function openDocument() {
    if (unsavedRef.current && !(await confirmDiscard())) return;
    try {
      const picked = await chooseOpenPath(await startFolder());
      if (!picked) return;
      loadDocument(picked, await readDocument(picked));
    } catch (error) {
      setNotice(`Could not open the file. ${error}`);
    }
  }

  /** Returns the saved path and text, or null if the user cancelled or saving failed. */
  async function saveDocument(saveAs = false): Promise<{ path: string; text: string } | null> {
    try {
      const text = editor.current?.getText() ?? source;
      let target = path;
      if (saveAs || !path) {
        const picked = await chooseSavePath(path, path ? null : await startFolder(), suggestFileName(text));
        if (!picked) return null;
        // A file chosen directly in Documents\Lexy gets its own project folder.
        target = await prepareSavePath(picked);
      }
      if (!target) return null;
      await writeDocument(target, text);
      setPath(target);
      pathRef.current = target;
      setSavedSource(text);
      setNotice((current) => (current?.startsWith("Could not save") ? null : current));
      return { path: target, text };
    } catch (error) {
      setNotice(`Could not save the file. ${error}`);
      return null;
    }
  }

  async function runCompile() {
    if (state.explicitBusy) return;
    const saved = await saveDocument();
    if (!saved) return;
    dispatch({ type: "start", origin: "explicit" });
    let result: CompileResult;
    try {
      result = await compileSource(saved.text, saved.path);
    } catch (error) {
      const text = String(error);
      result = { ok: false, summary: text, log: text, pdfPath: null, engine: "pdflatex" };
    }
    await showResult(result, "explicit", saved.text, saved.path);
  }

  function edit(change: (text: string, selection: { from: number; to: number }) => TextEdit) {
    const handle = editor.current;
    if (!handle) return;
    handle.apply(change(handle.getText(), handle.getSelection()));
  }

  function changeSettings(next: DocumentSettings) {
    const handle = editor.current;
    const text = handle?.getText() ?? source;
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
      handle?.replaceAll(updated);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
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

  const actions: RibbonActions = {
    onNew: () => void newDocument(),
    onOpen: () => void openDocument(),
    onSave: () => void saveDocument(),
    onSaveAs: () => void saveDocument(true),
    onCompile: () => void runCompile(),
    onToggleLogs: () => setLogsOpen((open) => !open),
    onToggleLive: () => setLiveEnabled((on) => !on),
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
  };
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    // Capture phase so these win over the editor's own bindings (Ctrl+L select line, Ctrl+I select parent).
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
      const run = actionsRef.current;
      let action: (() => void) | null = null;
      if (event.key === "F5" && !event.ctrlKey) action = run.onCompile;
      else if (ctrl && key === "s") action = event.shiftKey ? run.onSaveAs : run.onSave;
      else if (ctrl && !event.shiftKey) {
        action =
          { n: run.onNew, o: run.onOpen, l: run.onToggleLogs, b: () => run.onFormat("textbf"), i: () => run.onFormat("textit"), u: () => run.onFormat("underline") }[key] ??
          null;
      }
      if (!action) return;
      // Formatting shortcuts only apply while typing in the editor, not inside dialogs.
      if (["b", "i", "u"].includes(key) && !(event.target as HTMLElement | null)?.closest?.(".editor")) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    try {
      getCurrentWindow()
        .onCloseRequested(async (event) => {
          if (unsavedRef.current && !(await confirmDiscard())) {
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
              setNotice(`Lexy couldn't save the PDF next to your document: ${error}. Close again to quit without it.`);
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

  const compiling = state.status === "compiling";

  return (
    <main className="writer">
      <Ribbon
        actions={actions}
        state={{
          fileName: fileName(path),
          path,
          unsaved,
          statusLabel: statusLabel(state),
          statusClass: state.status,
          statusDetail: state.status === "error" ? state.summary : null,
          compiling: state.explicitBusy,
          logsOpen,
          liveEnabled,
          settings,
          settingsManaged,
        }}
      />

      {notice ? (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div
        className="panes"
        ref={panes}
        style={{ gridTemplateColumns: `minmax(0, ${split}fr) 6px minmax(0, ${1 - split}fr)` }}
      >
        <Editor
          handle={editor}
          value={source}
          label="LaTeX source"
          onChange={(next) => {
            setSource(next);
            dispatch({ type: "edit" });
            live.current?.edit(next);
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
            dragging.current = true;
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (dragging.current) splitFromPointer(event.clientX);
          }}
          onPointerUp={() => {
            dragging.current = false;
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
              <button type="button" onClick={() => setLogsOpen(true)}>
                Open log
              </button>
            </div>
          ) : null}
          <PdfView bytes={pdfBytes} busy={compiling} onError={setNotice} />
        </section>
      </div>

      {logsOpen ? (
        <section className="log-drawer" aria-label="Compile log">
          <div className="log-header">
            <strong>{state.summary ?? "No compile yet"}</strong>
            <button
              type="button"
              disabled={!state.log}
              onClick={() => void navigator.clipboard.writeText(state.log)}
            >
              Copy log
            </button>
          </div>
          <pre>{state.log || "No log yet"}</pre>
        </section>
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
    </main>
  );
}
