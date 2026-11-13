import { describe, expect, it, vi } from "vitest";
import type { CompileResult } from "./compile";
import { createLivePreview } from "./livePreview";

const ok = (text: string): CompileResult => ({ ok: true, summary: "PDF ready", log: text, pdfPath: "x.pdf", engine: "pdflatex" });

function setup() {
  const pending: { text: string; resolve: (result: CompileResult) => void; reject: (error: unknown) => void }[] = [];
  const compile = vi.fn(
    (text: string) =>
      new Promise<CompileResult>((resolve, reject) => {
        pending.push({ text, resolve, reject });
      }),
  );
  const onResult = vi.fn();
  vi.useFakeTimers();
  const live = createLivePreview({ compile, onResult });
  const finish = async (index = pending.length - 1) => {
    pending[index].resolve(ok(pending[index].text));
    await vi.advanceTimersByTimeAsync(0);
  };
  return { live, compile, onResult, pending, finish };
}

describe("createLivePreview", () => {
  it("compiles once, 1 s after the last edit", async () => {
    const { live, compile } = setup();
    live.edit("a");
    await vi.advanceTimersByTimeAsync(600);
    live.edit("ab");
    await vi.advanceTimersByTimeAsync(600);
    live.edit("abc");
    expect(live.state().phase).toBe("waiting");
    await vi.advanceTimersByTimeAsync(999);
    expect(compile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledWith("abc");
    expect(live.state().phase).toBe("running");
  });

  it("queues edits during a compile and then compiles only the newest text", async () => {
    const { live, compile, onResult, finish } = setup();
    live.edit("v1");
    await vi.advanceTimersByTimeAsync(1000);
    live.edit("v2");
    live.edit("v3");
    expect(live.state()).toMatchObject({ phase: "running", queued: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(compile).toHaveBeenCalledTimes(1);

    await finish();
    expect(onResult).toHaveBeenCalledWith(ok("v1"), "v1");
    expect(compile).toHaveBeenCalledTimes(2);
    expect(compile).toHaveBeenLastCalledWith("v3");

    await finish();
    expect(onResult).toHaveBeenLastCalledWith(ok("v3"), "v3");
    expect(live.state()).toMatchObject({ phase: "idle", queued: false });
  });

  it("never has more than one compile in flight during continuous typing", async () => {
    const { live, compile, pending, finish } = setup();
    let inFlight = 0;
    let maxInFlight = 0;
    compile.mockImplementation(
      (text: string) =>
        new Promise<CompileResult>((resolve) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          pending.push({ text, resolve: (r) => (inFlight--, resolve(r)), reject: () => {} });
        }),
    );
    for (let i = 0; i < 200; i++) {
      live.edit(`text ${i}`);
      await vi.advanceTimersByTimeAsync(i % 15 === 0 ? 1200 : 100);
      if (pending.length && i % 7 === 0) await finish(pending.length - 1);
    }
    expect(maxInFlight).toBe(1);
  });

  it("turns a thrown compile into a failed result", async () => {
    const { live, onResult, pending } = setup();
    live.edit("x");
    await vi.advanceTimersByTimeAsync(1000);
    pending[0].reject("compile task failed");
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith(
      { ok: false, summary: "compile task failed", log: "compile task failed", pdfPath: null, engine: "pdflatex" },
      "x",
    );
    expect(live.state().phase).toBe("idle");
  });

  it("disabling cancels the pending timer and stops new compiles", async () => {
    const { live, compile } = setup();
    live.edit("x");
    live.setEnabled(false);
    expect(live.state()).toMatchObject({ phase: "idle", enabled: false });
    live.edit("y");
    await vi.advanceTimersByTimeAsync(5000);
    expect(compile).not.toHaveBeenCalled();
    live.setEnabled(true);
    live.edit("z");
    await vi.advanceTimersByTimeAsync(1000);
    expect(compile).toHaveBeenCalledWith("z");
  });

  it("disabling during a compile drops the queued follow-up but still delivers the result", async () => {
    const { live, compile, onResult, finish } = setup();
    live.edit("a");
    await vi.advanceTimersByTimeAsync(1000);
    live.edit("b");
    live.setEnabled(false);
    await finish();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("now() compiles immediately, or queues behind a running compile", async () => {
    const { live, compile, finish } = setup();
    live.now("opened");
    expect(compile).toHaveBeenCalledWith("opened");
    live.now("again");
    expect(compile).toHaveBeenCalledTimes(1);
    await finish();
    expect(compile).toHaveBeenLastCalledWith("again");
  });

  it("now() works even when live preview is off (explicit request)", () => {
    const { live, compile } = setup();
    live.setEnabled(false);
    live.now("x");
    expect(compile).toHaveBeenCalledWith("x");
  });

  it("dispose stops timers and swallows late results", async () => {
    const { live, compile, onResult, finish } = setup();
    live.edit("a");
    await vi.advanceTimersByTimeAsync(1000);
    live.edit("b");
    live.dispose();
    await finish();
    expect(onResult).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(compile).toHaveBeenCalledTimes(1);
  });
});
