import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { defaultFolder, type DefaultFolder } from "./documents";
import { chooseProjectFolder, useChoice } from "./ProjectDialogs";
import { createProject, errorText, forgetProject, INVALID_NAME_MESSAGE, listProjects, validName, type ProjectSummary } from "./projects";
import { TemplateGallery, templateText } from "./TemplateGallery";
import { InfoBar } from "./InfoBar";

type Props = {
  /** Open this folder as the project. */
  onOpen: (path: string) => void;
  /** A notice from the app (for example a project that failed to open). */
  notice?: string | null;
};

const DAY = 24 * 60 * 60 * 1000;

/** "Today", "Yesterday", "3 days ago", else a short date. */
export function relativeDate(ms: number, now = Date.now()): string {
  if (!ms) return "";
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (ms >= startOfToday) return "Today";
  const days = Math.ceil((startOfToday - ms) / DAY);
  if (days <= 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function parentFolder(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

export function ProjectHome({ onOpen, notice: initialNotice = null }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [folder, setFolder] = useState<DefaultFolder | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("Untitled");
  const [template, setTemplate] = useState("blank");
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const { ask, dialog } = useChoice();

  async function refresh() {
    try {
      setProjects(await listProjects());
    } catch (error) {
      setProjects([]);
      setNotice(`Could not list projects. ${errorText(error)}`);
    }
  }

  useEffect(() => {
    void refresh();
    defaultFolder().then(setFolder, () => undefined);
  }, []);

  async function create() {
    const trimmed = name.trim();
    if (!validName(trimmed)) {
      setNameError(INVALID_NAME_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      onOpen(await createProject(trimmed, templateText(template)));
    } catch (error) {
      setNotice(`Could not create the project. ${errorText(error)}`);
      setBusy(false);
    }
  }

  async function openFolder() {
    try {
      const picked = await chooseProjectFolder(
        async () =>
          (await ask("Large folder", "This folder is large. Open anyway?", [
            { label: "Cancel", value: "cancel" },
            { label: "Open", value: "open", primary: true },
          ])) === "open",
        folder?.path,
      );
      if (picked) onOpen(picked);
    } catch (error) {
      setNotice(`Could not open the folder. ${errorText(error)}`);
    }
  }

  async function remove(project: ProjectSummary) {
    try {
      await forgetProject(project.path);
      await refresh();
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  function startNaming() {
    setName("Untitled");
    setTemplate("blank");
    setNameError(null);
    setNaming(true);
  }

  // Ctrl+N / Ctrl+O, like the Writer.
  const shortcuts = useRef({ startNaming, openFolder });
  shortcuts.current = { startNaming, openFolder };
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== "n" && key !== "o") return;
      if ((event.target as HTMLElement | null)?.closest?.(".dialog")) return;
      event.preventDefault();
      if (key === "n") shortcuts.current.startNaming();
      else void shortcuts.current.openFolder();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...(list.current?.querySelectorAll<HTMLButtonElement>("button.project-open") ?? [])];
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    next?.focus();
    event.preventDefault();
  }

  return (
    <main className="project-home">
      <header className="project-home-header">
        <h1>Lexy</h1>
        <div className="project-home-actions">
          <button type="button" className="primary" title="New project (Ctrl+N)" onClick={startNaming}>
            New project
          </button>
          <button type="button" title="Open folder (Ctrl+O)" onClick={() => void openFolder()}>
            Open folder…
          </button>
        </div>
      </header>

      {folder?.fallback ? <InfoBar severity="warning">Saving to {folder.path} because Documents isn't available.</InfoBar> : null}
      {notice ? (
        <InfoBar severity="error" onClose={() => setNotice(null)}>
          {notice}
        </InfoBar>
      ) : null}

      {naming ? (
        <form
          className="new-project"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label className="field">
            <span>Project name</span>
            <input
              autoFocus
              value={name}
              disabled={busy}
              aria-invalid={!!nameError}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setNaming(false);
                }
              }}
            />
          </label>
          <button type="submit" className="primary" disabled={busy}>
            Create
          </button>
          <button type="button" disabled={busy} onClick={() => setNaming(false)}>
            Cancel
          </button>
          {nameError ? (
            <p className="field-error" role="alert">
              {nameError}
            </p>
          ) : null}
          <TemplateGallery value={template} onChange={setTemplate} disabled={busy} />
        </form>
      ) : null}

      <section className="project-list" aria-label="Projects">
        {projects === null ? (
          <p role="status">Loading projects</p>
        ) : projects.length === 0 ? (
          <p className="empty">No projects yet. Create one or open a folder.</p>
        ) : (
          <ul ref={list} onKeyDown={onListKeyDown}>
            {projects.map((project) => (
              <li key={project.path} className={project.missing ? "project-row missing" : "project-row"}>
                <button
                  type="button"
                  className="project-open"
                  disabled={project.missing}
                  title={project.path}
                  onClick={() => onOpen(project.path)}
                >
                  <span className="project-name">{project.name}</span>
                  {project.inDefaultFolder ? null : <span className="project-location">{parentFolder(project.path)}</span>}
                  <span className="project-date">
                    {project.missing ? "Missing" : relativeDate(project.lastOpened ?? project.modified)}
                  </span>
                </button>
                {project.missing ? (
                  <button type="button" onClick={() => void remove(project)}>
                    Remove from list
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      {dialog}
    </main>
  );
}
