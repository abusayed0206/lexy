import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type ToolProbe = {
  name: string;
  installed: boolean;
  version?: string | null;
  path?: string | null;
  message: string;
};

type EnvironmentStatus = {
  ready: boolean;
  miktex: ToolProbe;
  perl: ToolProbe;
  latexmk: ToolProbe;
};

type SetupProgress = {
  step: string;
  label: string;
  detail: string;
  progress?: number | null;
  state: "running" | "done" | "error";
};

const setupSteps = [
  "Check",
  "Perl",
  "MiKTeX setup",
  "Packages",
  "Install",
  "Verify",
];

function App() {
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(
    null,
  );
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [setupRunning, setSetupRunning] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const unlisten = listen<SetupProgress>("setup-progress", (event) => {
      if (mounted) {
        setProgress(event.payload);
      }
    });

    invoke<EnvironmentStatus>("check_environment")
      .then((status) => {
        if (mounted) {
          setEnvironment(status);
        }
      })
      .catch((error) => {
        if (mounted) {
          setSetupError(String(error));
        }
      });

    return () => {
      mounted = false;
      unlisten.then((dispose) => dispose());
    };
  }, []);

  const tools = useMemo(
    () =>
      environment
        ? [environment.miktex, environment.latexmk, environment.perl]
        : [],
    [environment],
  );

  async function startSetup() {
    setSetupRunning(true);
    setSetupError(null);
    try {
      const status = await invoke<EnvironmentStatus>("start_initial_setup");
      setEnvironment(status);
    } catch (error) {
      setSetupError(String(error));
      try {
        const status = await invoke<EnvironmentStatus>("check_environment");
        setEnvironment(status);
      } catch {
        // Keep the original setup error visible.
      }
    } finally {
      setSetupRunning(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="setup-panel" aria-labelledby="setup-title">
        <div className="setup-header">
          <div>
            <p className="eyebrow">Lexy setup</p>
            <h1 id="setup-title">LaTeX tools</h1>
          </div>
          <span
            className={environment?.ready ? "status ready" : "status missing"}
          >
            {environment?.ready ? "Ready" : "Setup needed"}
          </span>
        </div>

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

        <div className="progress-block" aria-live="polite">
          <div className="progress-meta">
            <span>{progress?.label ?? "Waiting"}</span>
            <span>
              {progress?.progress != null ? `${progress.progress}%` : ""}
            </span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${progress?.progress ?? 0}%` }}
            />
          </div>
          <p>{progress?.detail ?? "Run initial setup to install missing tools."}</p>
        </div>

        <div className="step-strip" aria-label="Setup steps">
          {setupSteps.map((step) => (
            <span key={step}>{step}</span>
          ))}
        </div>

        {setupError ? <p className="error-text">{setupError}</p> : null}

        <div className="actions">
          <button
            className="primary"
            type="button"
            disabled={setupRunning || environment?.ready}
            onClick={startSetup}
          >
            {setupRunning ? "Setting up" : "Install missing tools"}
          </button>
          <button
            type="button"
            disabled={setupRunning}
            onClick={async () =>
              setEnvironment(await invoke<EnvironmentStatus>("check_environment"))
            }
          >
            Recheck
          </button>
        </div>
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
      <span className={tool.installed ? "pill ok" : "pill needed"}>
        {tool.installed ? "Installed" : "Missing"}
      </span>
    </div>
  );
}

export default App;
