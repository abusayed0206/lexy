import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ProjectHome } from "./ProjectHome";
import { closeProject, errorText, lastOpenProject, openProject, type OpenedProject } from "./projects";
import { EnvironmentStatus, SetupScreen } from "./SetupScreen";
import { Writer } from "./Writer";
import "./App.css";

/** After setup: reopen the last project, else Project Home (research R12). */
type Workspace = { phase: "starting" } | { phase: "home"; notice: string | null } | { phase: "project"; project: OpenedProject };

function App() {
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>({ phase: "starting" });

  useEffect(() => {
    let mounted = true;
    invoke<EnvironmentStatus>("check_environment")
      .then((status) => {
        if (mounted) {
          setEnvironment(status);
        }
      })
      .catch((error) => {
        if (mounted) {
          setCheckError(String(error));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const ready = !!environment?.ready;
  useEffect(() => {
    if (!ready) return;
    let mounted = true;
    lastOpenProject()
      .then((path) => (path ? openProject(path) : null))
      .then(
        (project) => mounted && setWorkspace(project ? { phase: "project", project } : { phase: "home", notice: null }),
        (error) => mounted && setWorkspace({ phase: "home", notice: `Could not reopen the last project. ${errorText(error)}` }),
      );
    return () => {
      mounted = false;
    };
  }, [ready]);

  async function open(path: string) {
    try {
      setWorkspace({ phase: "project", project: await openProject(path) });
    } catch (error) {
      setWorkspace({ phase: "home", notice: `Could not open the project. ${errorText(error)}` });
    }
  }

  async function goHome() {
    try {
      await closeProject();
    } catch {
      // The project is closed on the next open anyway; Home must still show.
    }
    setWorkspace({ phase: "home", notice: null });
  }

  function handleEnvironment(status: EnvironmentStatus) {
    setEnvironment(status);
    setCheckError(null);
  }

  if (ready) {
    if (workspace.phase === "project") {
      return (
        <Writer
          key={workspace.project.root}
          project={workspace.project}
          onSwitch={(target) => void (target === null ? goHome() : open(target))}
        />
      );
    }
    if (workspace.phase === "home") return <ProjectHome onOpen={(path) => void open(path)} notice={workspace.notice} />;
    return (
      <main className="app-shell">
        <p role="status">Opening project</p>
      </main>
    );
  }

  if (!environment && !checkError) {
    return (
      <main className="app-shell">
        <p role="status">Checking tools</p>
      </main>
    );
  }

  return <SetupScreen environment={environment} checkError={checkError} onEnvironment={handleEnvironment} />;
}

export default App;
