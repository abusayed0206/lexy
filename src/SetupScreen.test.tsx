import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialSteps, SETUP_STEPS, SetupScreen, type EnvironmentStatus, type SetupProgress } from "./SetupScreen";

type Handler = (event: { payload: SetupProgress }) => void;
const handlers: Handler[] = [];
const unlisten = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, handler: Handler) => {
    handlers.push(handler);
    return Promise.resolve(unlisten);
  }),
}));
const invokeMock = vi.mocked(invoke);

const tool = (name: string, installed: boolean) => ({
  name,
  installed,
  version: installed ? `${name} 1.0` : null,
  path: installed ? `C:\\tools\\${name}.exe` : null,
  message: installed ? `${name} is available.` : `${name} was not found.`,
});
const env = (perl: boolean, miktex: boolean, latexmk: boolean): EnvironmentStatus => ({
  ready: perl && miktex && latexmk,
  miktex: tool("MiKTeX", miktex),
  perl: tool("Strawberry Perl", perl),
  latexmk: tool("latexmk", latexmk),
});
const perlMissing = env(false, true, true);
const readyEnv = env(true, true, true);

function emit(payload: Partial<SetupProgress> & Pick<SetupProgress, "step" | "state">) {
  act(() =>
    handlers.forEach((handler) =>
      handler({ payload: { label: "", detail: "", progress: 0, bytesDone: null, bytesTotal: null, ...payload } }),
    ),
  );
}

const step = (label: RegExp | string) => screen.getAllByRole("listitem").find((item) => within(item).queryByText(label))!;

describe("initialSteps", () => {
  it("plans every step when nothing is installed", () => {
    const steps = initialSteps(env(false, false, false));
    expect(Object.values(steps).every((s) => s.state === "pending")).toBe(true);
  });

  it("skips Perl steps when Perl is installed and MiKTeX steps when MiKTeX and latexmk are", () => {
    const steps = initialSteps(env(true, true, true));
    for (const s of SETUP_STEPS.filter((s) => s.tool)) expect(steps[s.id].state).toBe("skipped");
    expect(steps.check.state).toBe("pending");
  });

  it("does not plan a latexmk install when latexmk.exe exists but can't run without Perl", () => {
    const blocked = env(false, true, false);
    blocked.latexmk = { ...blocked.latexmk, path: "C:\\MiKTeX\\latexmk.exe", message: "latexmk is installed but could not run" };
    const steps = initialSteps(blocked);
    expect(steps["perl-download"].state).toBe("pending");
    for (const id of ["miktex-download", "miktex-extract", "miktex-packages", "miktex-install"]) expect(steps[id].state).toBe("skipped");
  });

  it("only installs latexmk when MiKTeX is present without it", () => {
    const steps = initialSteps(env(true, true, false));
    expect(steps["miktex-packages"]).toMatchObject({ state: "pending", label: "Install latexmk" });
    expect(steps["miktex-download"].state).toBe("skipped");
    expect(steps["miktex-install"].state).toBe("skipped");
  });
});

describe("SetupScreen", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    handlers.length = 0;
    unlisten.mockReset();
  });

  it("explains what will be installed, with no admin rights and the download size", () => {
    render(<SetupScreen environment={perlMissing} checkError={null} onEnvironment={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Install LaTeX tools" })).toBeInTheDocument();
    expect(screen.getByText(/no administrator rights/)).toBeInTheDocument();
    expect(screen.getByText("Strawberry Perl: about 290 MB download.")).toBeInTheDocument();
    expect(screen.queryByText(/MiKTeX: downloads/)).not.toBeInTheDocument();
    expect(screen.getByText("Setup needed")).toBeInTheDocument();
  });

  it("lists tools with installed state, version or message, and path", () => {
    render(<SetupScreen environment={perlMissing} checkError={null} onEnvironment={vi.fn()} />);
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getAllByText("Installed")).toHaveLength(2);
    expect(screen.getByText("Strawberry Perl was not found.")).toBeInTheDocument();
    expect(screen.getByText("C:\\tools\\MiKTeX.exe")).toBeInTheDocument();
  });

  it("shows the planned steps, marking ones that aren't needed", () => {
    render(<SetupScreen environment={perlMissing} checkError={null} onEnvironment={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Setup steps" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(SETUP_STEPS.length);
    expect(within(step("Download Strawberry Perl (290 MB)")).getByText("Waiting")).toBeInTheDocument();
    expect(within(step("Install MiKTeX")).getByText("Not needed")).toBeInTheDocument();
  });

  it("subscribes to setup-progress and unsubscribes on unmount", async () => {
    const { unmount } = render(<SetupScreen environment={perlMissing} checkError={null} onEnvironment={vi.fn()} />);
    expect(listen).toHaveBeenCalledWith("setup-progress", expect.any(Function));
    unmount();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalled();
  });

  it("runs setup and shows live step progress with bytes, speed and an overall bar", async () => {
    const user = userEvent.setup();
    invokeMock.mockReturnValueOnce(new Promise(() => {}));
    render(<SetupScreen environment={perlMissing} checkError={null} onEnvironment={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Install missing tools" }));
    expect(invokeMock).toHaveBeenCalledWith("start_initial_setup");
    expect(screen.getByRole("button", { name: "Installing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Recheck" })).toBeDisabled();
    expect(screen.getAllByText("Installing").find((el) => el.classList.contains("status"))).toBeDefined();

    emit({ step: "check", state: "done", label: "Checked existing tools", detail: "Missing: Strawberry Perl.", progress: 2 });
    emit({
      step: "perl-download",
      state: "running",
      label: "Downloading Strawberry Perl",
      detail: "45.0 MiB of 290.2 MiB · 5.0 MiB/s · about 49 s left",
      progress: 9,
      bytesDone: 45,
      bytesTotal: 290,
    });

    const running = step("Downloading Strawberry Perl");
    expect(running).toHaveAttribute("aria-current", "step");
    expect(within(running).getByText("In progress")).toBeInTheDocument();
    expect(within(running).getByText(/5.0 MiB\/s · about 49 s left/)).toBeInTheDocument();
    expect(running.querySelector(".step-fill")).toHaveStyle({ width: "16%" });
    expect(within(step("Checked existing tools")).getByText("Done")).toBeInTheDocument();

    const bar = screen.getByRole("progressbar", { name: "Setup progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "9");
    expect(screen.getByText("9%")).toBeInTheDocument();
  });

  it("hands the final environment over when setup succeeds", async () => {
    const user = userEvent.setup();
    const onEnvironment = vi.fn();
    invokeMock.mockResolvedValueOnce(readyEnv);
    render(<SetupScreen environment={perlMissing} checkError={null} onEnvironment={onEnvironment} />);
    await user.click(screen.getByRole("button", { name: "Install missing tools" }));
    expect(onEnvironment).toHaveBeenCalledWith(readyEnv);
  });

  it("on failure: shows the step error, a retry hint, rechecks, and offers Try again", async () => {
    const user = userEvent.setup();
    const onEnvironment = vi.fn();
    let fail!: (error: unknown) => void;
    invokeMock.mockReturnValueOnce(new Promise((_, reject) => (fail = reject))).mockResolvedValueOnce(perlMissing);
    render(<SetupScreen environment={perlMissing} checkError={null} onEnvironment={onEnvironment} />);
    await user.click(screen.getByRole("button", { name: "Install missing tools" }));
    emit({ step: "perl-download", state: "error", label: "Downloading Strawberry Perl failed", detail: "Could not reach github.com." });
    await act(async () => fail("Downloading Strawberry Perl failed: Could not reach github.com."));

    expect(screen.getByRole("alert")).toHaveTextContent("Setup stopped. Downloading Strawberry Perl failed: Could not reach github.com.");
    expect(screen.getByRole("alert")).toHaveTextContent("Finished downloads are kept");
    expect(within(step("Downloading Strawberry Perl failed")).getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenNthCalledWith(2, "check_environment");
    expect(onEnvironment).toHaveBeenCalledWith(perlMissing);

    invokeMock.mockReturnValueOnce(new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(invokeMock).toHaveBeenLastCalledWith("start_initial_setup");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the setup error if the follow-up check also fails", async () => {
    const user = userEvent.setup();
    const onEnvironment = vi.fn();
    invokeMock.mockRejectedValueOnce("Setup is already running.").mockRejectedValueOnce("check failed");
    render(<SetupScreen environment={perlMissing} checkError={null} onEnvironment={onEnvironment} />);
    await user.click(screen.getByRole("button", { name: "Install missing tools" }));
    expect(await screen.findByText(/Setup is already running\./)).toBeInTheDocument();
    expect(onEnvironment).not.toHaveBeenCalled();
  });

  it("shows the setup log in Details, with refresh and copy", async () => {
    const user = userEvent.setup();
    invokeMock.mockResolvedValueOnce("[    0.0s] check done: Checked existing tools").mockResolvedValueOnce("second read");
    render(<SetupScreen environment={perlMissing} checkError={null} onEnvironment={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Show details" }));
    expect(invokeMock).toHaveBeenCalledWith("read_setup_log");
    expect(await screen.findByLabelText("Setup log")).toHaveTextContent("check done: Checked existing tools");
    await user.click(screen.getByRole("button", { name: "Copy log" }));
    expect(await navigator.clipboard.readText()).toContain("check done");
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("second read")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByLabelText("Setup log")).not.toBeInTheDocument();
  });

  it("says so when the log can't be read", async () => {
    const user = userEvent.setup();
    invokeMock.mockRejectedValueOnce("LOCALAPPDATA is not set");
    render(<SetupScreen environment={perlMissing} checkError={null} onEnvironment={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Show details" }));
    expect(await screen.findByText(/Could not read the setup log. LOCALAPPDATA is not set/)).toBeInTheDocument();
  });

  it("shows a Recheck failure instead of losing it", async () => {
    const user = userEvent.setup();
    invokeMock.mockRejectedValueOnce("probe crashed");
    render(<SetupScreen environment={perlMissing} checkError={null} onEnvironment={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Recheck" }));
    expect(await screen.findByText(/probe crashed/)).toBeInTheDocument();
  });

  it("shows the initial check error and a pending row while nothing is known", () => {
    render(<SetupScreen environment={null} checkError="boom" onEnvironment={vi.fn()} />);
    expect(screen.getByText("Checking installed tools")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("disables Install when everything is ready", () => {
    render(<SetupScreen environment={readyEnv} checkError={null} onEnvironment={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Install missing tools" })).toBeDisabled();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
});
