type Timer = ReturnType<typeof setTimeout>;

export type RecoveryFile = { path: string; text: string; dirty: boolean };

export type RecoverySchedulerOptions = {
  save: (path: string, text: string) => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  /** Called once, on the first failed save (spec 008 FR-010). */
  onError: (error: unknown) => void;
  delayMs?: number;
  maxWaitMs?: number;
  setTimer?: (callback: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  now?: () => number;
};

export type RecoveryScheduler = {
  /** The open files changed: unsaved ones are kept after a pause; saved, reloaded or closed ones lose their copy. */
  changed: (files: RecoveryFile[]) => void;
  /** Stop without writing anything still pending (clean close). */
  dispose: () => void;
};

/**
 * Debounced writer of recovery copies (spec 008 research R3): a copy is written `delayMs`
 * after the last change, and never later than `maxWaitMs` after the first unwritten change,
 * so continuous typing is still covered. Only unsaved files whose text changed are sent.
 */
export function createRecoveryScheduler({
  save,
  discard,
  onError,
  delayMs = 2000,
  maxWaitMs = 10000,
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer),
  now = () => Date.now(),
}: RecoverySchedulerOptions): RecoveryScheduler {
  /** Text last sent per path (paths with a copy on disk). */
  const sent = new Map<string, string>();
  let pending = new Map<string, string>();
  let timer: Timer | null = null;
  let firstPending: number | null = null;
  let failed = false;
  let disposed = false;

  function flush() {
    timer = null;
    firstPending = null;
    const batch = pending;
    pending = new Map();
    for (const [path, text] of batch) {
      sent.set(path, text);
      save(path, text).catch((error) => {
        sent.delete(path);
        if (!failed) {
          failed = true;
          onError(error);
        }
      });
    }
  }

  function schedule() {
    const at = now();
    if (firstPending === null) firstPending = at;
    if (timer !== null) clearTimer(timer);
    const wait = Math.max(0, Math.min(delayMs, firstPending + maxWaitMs - at));
    timer = setTimer(flush, wait);
  }

  return {
    changed(files) {
      if (disposed) return;
      const open = new Set(files.map((file) => file.path));
      const stale: string[] = [];
      for (const file of files) {
        if (file.dirty) {
          if (sent.get(file.path) !== file.text && pending.get(file.path) !== file.text) pending.set(file.path, file.text);
        } else {
          pending.delete(file.path);
          if (sent.delete(file.path)) stale.push(file.path);
        }
      }
      for (const path of [...sent.keys()]) {
        if (!open.has(path)) {
          sent.delete(path);
          stale.push(path);
        }
      }
      for (const path of [...pending.keys()]) if (!open.has(path)) pending.delete(path);
      if (stale.length) void discard(stale).catch(() => undefined);
      if (pending.size) schedule();
      else if (timer !== null) {
        clearTimer(timer);
        timer = null;
        firstPending = null;
      }
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending.clear();
    },
  };
}
