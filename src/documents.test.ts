import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const LEXY = "C:\Users\me\Documents\Lexy";

describe("defaultFolder", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(invoke).mockReset();
  });

  it("asks the backend once per session", async () => {
    vi.mocked(invoke).mockResolvedValue({ path: LEXY, fallback: false });
    const { defaultFolder } = await import("./documents");
    await expect(defaultFolder()).resolves.toEqual({ path: LEXY, fallback: false });
    await defaultFolder();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("default_document_folder");
  });

  it("retries after a failure", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("no folder").mockResolvedValueOnce({ path: "C:\h", fallback: true });
    const { defaultFolder } = await import("./documents");
    await expect(defaultFolder()).rejects.toBe("no folder");
    await expect(defaultFolder()).resolves.toEqual({ path: "C:\h", fallback: true });
  });
});
