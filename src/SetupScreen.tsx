import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ToolProbe = {
  name: string;
  installed: boolean;
  version?: string | null;
  path?: string | null;
  message: string;
};

export type EnvironmentStatus = {
  ready: boolean;
  miktex: ToolProbe;
  perl: ToolProbe;
  latexmk: ToolProbe;
};

/** Mirrors `SetupProgress` in src-tauri/src/setup.rs. */
export type SetupProgress = {
  step: string;
  state: "running" | "done" | "skipped" | "error";
  label: string;
  detail: string;
  progress: number;
  bytesDone?: number | null;
  bytesTotal?: number | null;
};

type StepState = "pending" | SetupProgress["state"];
type StepView = { state: StepState; label: string; detail: string; bytesDone?: number | null; bytesTotal?: number | null };

/** Step ids must match the `Step` constants in src-tauri/src/setup.rs. */
export const SETUP_STEPS = [
  { id: "check", label: "Check installed tools", tool: null },
  { id: "perl-download", label: "Download Strawberry Perl (290 MB)", tool: "perl" },
  { id: "perl-extract", label: "Unpack Strawberry Perl", tool: "perl" },
  { id: "miktex-download", label: "Download MiKTeX setup", tool: "miktex" },
  { id: "miktex-extract", label: "Unpack MiKTeX setup", tool: "miktex" },
  { id: "miktex-packages", label: "Download MiKTeX packages", tool: "miktex" },
  { id: "miktex-install", label: "Install MiKTeX", tool: "miktex" },
  { id: "verify", label: "Verify tools", tool: null },
] as const;

const STATE_TEXT: Record<StepState, string> = {
  pending: "Waiting",
  running: "In progress",
  done: "Done",
  skipped: "Not needed",
  error: "Failed",
};

/** What the plan looks like before anything runs, from what is already installed. */
export function initialSteps(environment: EnvironmentStatus | null): Record<string, StepView> {
  const perlOk = !!environment?.perl.installed;
  const miktexOk = !!environment?.miktex.installed;
  // Like miktex_plan in setup.rs: latexmk.exe on disk counts, even if it can't run until Perl is installed.
  const latexmkOnDisk = !!environment?.latexmk.path;
  const views: Record<string, StepView> = {};
  for (const step of SETUP_STEPS) {
    let state: StepState = "pending";
    let label: string = step.label;
    if (environment && step.tool === "perl" && perlOk) state = "skipped";
    if (environment && step.tool === "miktex") {
      if (miktexOk && latexmkOnDisk) state = "skipped";
      else if (miktexOk) {
        if (step.id === "miktex-packages") label = "Install latexmk";
        else state = "skipped";
      }
    }
    views[step.id] = { state, label, detail: "" };
  }
  return views;
}

type Phase = "idle" | "running" | "failed";

type Props = {
  environment: EnvironmentStatus | null;
  checkError: string | null;
  onEnvironment: (status: EnvironmentStatus) => void;
};

export function SetupScreen({ environment, checkError, onEnvironment }: Props) {
  const [steps, setSteps] = useState(() => initialSteps(environment));
  const [overall, setOverall] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [log, setLog] = useState<string | null>(null);

  // Before a run starts, the plan follows the latest environment check.
  useEffect(() => {
    if (phase === "idle") setSteps(initialSteps(environment));
  }, [environment, phase]);

  useEffect(() => {
    let mounted = true;
    const unlisten = listen<SetupProgress>("setup-progress", ({ payload }) => {
      if (!mounted) return;
      setOverall(payload.progress);
      setSteps((current) => ({
        ...current,
        [payload.step]: {
          state: payload.state,
          label: payload.label,
          detail: payload.detail,
          bytesDone: payload.bytesDone,
          bytesTotal: payload.bytesTotal,
        },
      }));
    });
    return () => {
      mounted = false;
      unlisten.then((dispose) => dispose()).catch(() => {});
    };
  }, []);

  async function loadLog() {
    try {
      setLog((await invoke<string>("read_setup_log")) || "The log is empty.");
    } catch (error) {
      setLog(`Could not read the setup log. ${error}`);
    }
  }

  useEffect(() => {
    if (detailsOpen) void loadLog();
  }, [detailsOpen, phase]);

  async function startSetup() {
    setPhase("running");
    setSetupError(null);
    setOverall(0);
    setSteps(initialSteps(environment));
    try {
      const status = await invoke<EnvironmentStatus>("start_initial_setup");
      setPhase("idle");
      onEnvironment(status);
    } catch (error) {
      setSetupError(String(error));
      setPhase("failed");
      try {
        onEnvironment(await invoke<EnvironmentStatus>("check_environment"));
      } catch {
        // Keep the setup error visible.
      }
    }
  }

  async function recheck() {
    setSetupError(null);
    try {
      onEnvironment(await invoke<EnvironmentStatus>("check_environment"));
      setPhase("idle");
    } catch (error) {
      setSetupError(String(error));
    }
  }

  const tools = useMemo(() => (environment ? [environment.miktex, environment.latexmk, environment.perl] : []), [environment]);
  const running = phase === "running";
  const current = SETUP_STEPS.find((step) => steps[step.id]?.state === "running");
  const errorText = setupError ?? checkError;
  const perlMissing = environment ? !environment.perl.installed : false;
  const miktexMissing = environment ? !environment.miktex.installed : false;

  const pill = environment?.ready
    ? { text: "Ready", className: "status ready" }
    : running
      ? { text: "Installing", className: "status busy" }
      : phase === "failed"
        ? { text: "Needs attention", className: "status failed" }
        : { text: "Setup needed", className: "status missing" };

  return (
    <main className="app-shell">
      <section className="setup-panel" aria-labelledby="setup-title">
        <div className="setup-header">
          <div>
            <p className="eyebrow">Lexy setup</p>
            <h1 id="setup-title">Install LaTeX tools</h1>
          </div>
          <span className={pill.className}>{pill.text}</span>
        </div>

        <p className="setup-intro">
          Lexy needs MiKTeX, latexmk and Strawberry Perl to turn your writing into PDFs. They install for your Windows
          account only: no administrator rights, nothing else on your PC changes.
        </p>
        {!running && (perlMissing || miktexMissing) ? (
          <ul className="setup-sizes">
            {perlMissing ? <li>Strawberry Perl: about 290 MB download.</li> : null}
            {miktexMissing ? <li>MiKTeX: downloads its basic package set, which can take a while.</li> : null}
          </ul>
        ) : null}

        <div className="tool-list">
          {tools.length === 0 ? (
            <div className="tool-row muted">
              <span>Checking installed tools</span>
              <span>Pending</span>
            </div>
          ) : (
            tools.map((tool) => <ToolRow key={tool.name} tool={tool} />)
          )}
        </div>

        {running || phase === "failed" || overall > 0 ? (
          <div className="progress-block">
            <div className="progress-meta">
              <span>{current ? steps[current.id].label : running ? "Starting" : "Stopped"}</span>
              <span>{overall}%</span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Setup progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={overall}
            >
              <div className="progress-fill" style={{ width: `${overall}%` }} />
            </div>
          </div>
        ) : null}

        <ol className="setup-steps" aria-label="Setup steps">
          {SETUP_STEPS.map((step) => {
            const view = steps[step.id];
            const bytesFraction = view.bytesTotal ? Math.min(1, (view.bytesDone ?? 0) / view.bytesTotal) : null;
            return (
              <li key={step.id} className={`setup-step ${view.state}`} aria-current={view.state === "running" ? "step" : undefined}>
                <span className="step-icon" aria-hidden="true" />
                <div className="step-body">
                  <div className="step-line">
                    <span className="step-label">{view.state === "skipped" ? step.label : view.label}</span>
                    <span className="step-state">{STATE_TEXT[view.state]}</span>
                  </div>
                  {view.detail && view.state !== "pending" ? <div className="step-detail">{view.detail}</div> : null}
                  {view.state === "running" && bytesFraction !== null ? (
                    <div className="step-track" aria-hidden="true">
                      <div className="step-fill" style={{ width: `${Math.round(bytesFraction * 100)}%` }} />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        {errorText ? (
          <div className="error-text" role="alert">
            <strong>Setup stopped.</strong> {errorText}
            {phase === "failed" ? <div className="error-hint">Finished downloads are kept, so trying again continues from there.</div> : null}
          </div>
        ) : null}

        <div className="actions">
          <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
            {detailsOpen ? "Hide details" : "Show details"}
          </button>
          <span className="actions-spacer" />
          <button type="button" disabled={running} onClick={recheck}>
            Recheck
          </button>
          <button className="primary" type="button" disabled={running || environment?.ready} onClick={startSetup}>
            {running ? "Installing" : phase === "failed" ? "Try again" : "Install missing tools"}
          </button>
        </div>

        {detailsOpen ? (
          <div className="setup-details">
            <div className="log-header">
              <strong>Setup log</strong>
              <span className="actions-spacer" />
              <button type="button" onClick={() => void loadLog()}>
                Refresh
              </button>
              <button type="button" disabled={!log} onClick={() => void navigator.clipboard.writeText(log ?? "")}>
                Copy log
              </button>
            </div>
            <pre aria-label="Setup log">{log ?? "Loading"}</pre>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function ToolRow({ tool }: { tool: ToolProbe }) {
  return (
    <div className="tool-row">
      <div>
        <strong>{tool.name}</strong>
        <small>{tool.version ?? tool.message}</small>
        {tool.path ? <code>{tool.path}</code> : null}
      </div>
      <span className={tool.installed ? "pill ok" : "pill needed"}>{tool.installed ? "Installed" : "Missing"}</span>
    </div>
  );
}
