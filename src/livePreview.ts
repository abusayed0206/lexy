import type { CompileResult } from "./compile";

type Timer = ReturnType<typeof setTimeout>;

export type LivePreviewOptions = {
  delayMs?: number;
  compile: (text: string) => Promise<CompileResult>;
  onResult: (result: CompileResult, text: string) => void;
  setTimer?: (callback: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

export type LivePreview = {
  /** The text changed: (re)start the pause timer, or queue behind a running compile. */
  edit: (text: string) => void;
  /** Compile now (document opened, explicit refresh); still at most one at a time. */
  now: (text: string) => void;
  setEnabled: (enabled: boolean) => void;
  dispose: () => void;
  state: () => { phase: "idle" | "waiting" | "running"; queued: boolean; enabled: boolean };
};

/**
 * Debounced, coalescing compile scheduler (data-model.md LivePreviewState):
 * never more than one compile running plus one queued, and the queued one always
 * uses the newest text.
 */
export function createLivePreview({
  delayMs = 1000,
  compile,
  onResult,
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer),
}: LivePreviewOptions): LivePreview {
  let enabled = true;
  let disposed = false;
  let phase: "idle" | "waiting" | "running" = "idle";
  let queued = false;
  let latest: string | null = null;
  let timer: Timer | undefined;

  function cancelTimer() {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  }

  async function run() {
    phase = "running";
    queued = false;
    const text = latest as string;
    let result: CompileResult;
    try {
      result = await compile(text);
    } catch (error) {
      const message = String(error);
      result = { ok: false, summary: message, log: message, pdfPath: null, engine: "pdflatex" };
    }
    if (disposed) return;
    onResult(result, text);
    if (queued && enabled) void run();
    else {
      phase = "idle";
      queued = false;
    }
  }

  function edit(text: string) {
    latest = text;
    if (!enabled || disposed) return;
    if (phase === "running") {
      queued = true;
      return;
    }
    cancelTimer();
    phase = "waiting";
    timer = setTimer(() => {
      timer = undefined;
      if (enabled && !disposed) void run();
      else phase = "idle";
    }, delayMs);
  }

  function now(text: string) {
    latest = text;
    if (disposed) return;
    if (phase === "running") {
      queued = true;
      return;
    }
    cancelTimer();
    void run();
  }

  return {
    edit,
    now,
    setEnabled(next) {
      enabled = next;
      if (!next) {
        cancelTimer();
        queued = false;
        if (phase === "waiting") phase = "idle";
      }
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
    state: () => ({ phase, queued, enabled }),
  };
}
