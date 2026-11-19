import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRecoveryScheduler } from "./recovery";

describe("createRecoveryScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const save = vi.fn(async (_path: string, _text: string) => undefined);
    const discard = vi.fn(async (_paths: string[]) => undefined);
    const onError = vi.fn();
    const scheduler = createRecoveryScheduler({ save, discard, onError, now: () => Date.now() });
    return { save, discard, onError, scheduler };
  }

  it("writes an unsaved file 2 s after the last change", () => {
    const { save, scheduler } = setup();
    scheduler.changed([{ path: "a.tex", text: "x", dirty: true }]);
    vi.advanceTimersByTime(1500);
    scheduler.changed([{ path: "a.tex", text: "xy", dirty: true }]);
    vi.advanceTimersByTime(1999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledWith("a.tex", "xy");
  });

  it("writes at least every 10 s while typing never pauses", () => {
    const { save, scheduler } = setup();
    for (let i = 0; i < 12; i++) {
      scheduler.changed([{ path: "a.tex", text: `t${i}`, dirty: true }]);
      vi.advanceTimersByTime(1000);
    }
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toBe("t9");
  });

  it("sends only unsaved files whose text changed since the last copy", () => {
    const { save, scheduler } = setup();
    scheduler.changed([
      { path: "a.tex", text: "a1", dirty: true },
      { path: "b.tex", text: "b", dirty: false },
    ]);
    vi.advanceTimersByTime(2000);
    scheduler.changed([
      { path: "a.tex", text: "a1", dirty: true },
      { path: "b.tex", text: "b", dirty: false },
    ]);
    vi.advanceTimersByTime(2000);
    expect(save.mock.calls).toEqual([["a.tex", "a1"]]);
  });

  it("drops the copy when a file is saved, reloaded or closed", () => {
    const { save, discard, scheduler } = setup();
    scheduler.changed([
      { path: "a.tex", text: "a1", dirty: true },
      { path: "b.tex", text: "b1", dirty: true },
    ]);
    vi.advanceTimersByTime(2000);
    scheduler.changed([{ path: "a.tex", text: "a1", dirty: false }]);
    expect(discard).toHaveBeenCalledWith(["a.tex", "b.tex"]);
    // Editing again after the save writes a new copy.
    scheduler.changed([{ path: "a.tex", text: "a2", dirty: true }]);
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenLastCalledWith("a.tex", "a2");
  });

  it("never discards a file that had no copy", () => {
    const { discard, scheduler } = setup();
    scheduler.changed([{ path: "a.tex", text: "a", dirty: true }]);
    scheduler.changed([{ path: "a.tex", text: "a", dirty: false }]);
    vi.advanceTimersByTime(5000);
    expect(discard).not.toHaveBeenCalled();
  });

  it("reports a failed write only once and retries the file later", async () => {
    const { save, onError, scheduler } = setup();
    save.mockRejectedValue(new Error("disk full"));
    scheduler.changed([{ path: "a.tex", text: "1", dirty: true }]);
    await vi.advanceTimersByTimeAsync(2000);
    scheduler.changed([{ path: "a.tex", text: "1", dirty: true }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("dispose cancels a pending write", () => {
    const { save, scheduler } = setup();
    scheduler.changed([{ path: "a.tex", text: "x", dirty: true }]);
    scheduler.dispose();
    vi.advanceTimersByTime(20000);
    scheduler.changed([{ path: "a.tex", text: "y", dirty: true }]);
    vi.advanceTimersByTime(20000);
    expect(save).not.toHaveBeenCalled();
  });
});
