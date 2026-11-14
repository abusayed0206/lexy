import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { FontChoice } from "./latex/fonts";
import type { DocumentSettings, FontSize } from "./latex/settings";
import type { TableSpec } from "./latex/tables";
import { FontPicker } from "./ribbon/FontPicker";
import { Icon, type IconName } from "./ribbon/icons";
import { LayoutMenu } from "./ribbon/LayoutMenu";
import { MenuButton } from "./ribbon/Menu";
import { TablePicker } from "./ribbon/TablePicker";
import type { GitState } from "./git";
import type { GitAction } from "./GitPanel";

export const RIBBON_TABS = ["file", "home", "insert", "layout", "view", "git"] as const;
export type RibbonTab = (typeof RIBBON_TABS)[number];
const TAB_LABELS: Record<RibbonTab, string> = { file: "File", home: "Home", insert: "Insert", layout: "Layout", view: "View", git: "Git" };
const TAB_KEY = "lexy.ribbonTab";

export type RibbonActions = {
  /** New file in the current folder. */
  onNew: () => void;
  onNewProject: () => void;
  /** Open folder… */
  onOpen: () => void;
  onHome: () => void;
  onRecent: (path: string) => void;
  /** Save all modified files. */
  onSave: () => void;
  /** Save the current file under another name in the project. */
  onSaveAs: () => void;
  onCompile: () => void;
  onToggleLogs: () => void;
  /** Ctrl+J: show the cursor's line in the PDF. */
  onShowInPdf: () => void;
  onZoom: (kind: "in" | "out" | "fit") => void;
  onToggleLive: () => void;
  onToggleFiles: () => void;
  onFormat: (command: "textbf" | "textit" | "underline") => void;
  onList: (kind: "itemize" | "enumerate") => void;
  onHeading: (level: 0 | 1 | 2 | 3) => void;
  onPageBreak: () => void;
  onFootnote: () => void;
  onEquation: () => void;
  onTable: (spec: TableSpec) => void;
  onFont: (font: FontChoice) => void;
  onSize: (size: FontSize) => void;
  onLayout: (settings: DocumentSettings) => void;
  onGit: (action: GitAction) => void;
};

export type RibbonState = {
  fileName: string;
  path: string | null;
  unsaved: boolean;
  /** The shown file is the project's main document. */
  isMain: boolean;
  projectName: string;
  mainName: string | null;
  statusLabel: string;
  statusClass: string;
  statusDetail: string | null;
  compiling: boolean;
  readOnly: boolean;
  logsOpen: boolean;
  liveEnabled: boolean;
  filesOpen: boolean;
  recent: { path: string; name: string }[];
  settings: DocumentSettings;
  settingsManaged: boolean;
  git: GitState | null;
  gitOpen: boolean;
  /** "Fit" or "125 %". */
  zoomLabel: string;
};

function loadTab(): RibbonTab {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return RIBBON_TABS.includes(saved as RibbonTab) ? (saved as RibbonTab) : "home";
  } catch {
    return "home";
  }
}

function saveTab(tab: RibbonTab) {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // Storage blocked: the tab just isn't remembered.
  }
}

export function Ribbon({ actions, state }: { actions: RibbonActions; state: RibbonState }) {
  const [tab, setTab] = useState<RibbonTab>(loadTab);
  const tabRefs = useRef<Record<RibbonTab, HTMLButtonElement | null>>({ file: null, home: null, insert: null, layout: null, view: null, git: null });
  const baseId = useId();

  function select(next: RibbonTab, focus = false) {
    setTab(next);
    saveTab(next);
    if (focus) tabRefs.current[next]?.focus();
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = RIBBON_TABS.indexOf(tab);
    const target =
      event.key === "ArrowRight"
        ? RIBBON_TABS[(index + 1) % RIBBON_TABS.length]
        : event.key === "ArrowLeft"
          ? RIBBON_TABS[(index - 1 + RIBBON_TABS.length) % RIBBON_TABS.length]
          : event.key === "Home"
            ? RIBBON_TABS[0]
            : event.key === "End"
              ? RIBBON_TABS[RIBBON_TABS.length - 1]
              : null;
    if (!target) return;
    event.preventDefault();
    select(target, true);
  }

  const panelId = (name: RibbonTab) => `${baseId}-panel-${name}`;
  const tabId = (name: RibbonTab) => `${baseId}-tab-${name}`;

  return (
    <header className="ribbon">
      <div className="ribbon-top">
        <div className="ribbon-tabs" role="tablist" aria-label="Ribbon">
          {RIBBON_TABS.map((name) => (
            <button
              key={name}
              ref={(element) => {
                tabRefs.current[name] = element;
              }}
              id={tabId(name)}
              type="button"
              role="tab"
              className="ribbon-tab"
              aria-selected={tab === name}
              aria-controls={panelId(name)}
              tabIndex={tab === name ? 0 : -1}
              onClick={() => select(name)}
              onKeyDown={onTabKeyDown}
            >
              {TAB_LABELS[name]}
            </button>
          ))}
        </div>

        <div
          className="doc-title"
          title={[state.path, state.mainName ? `Main: ${state.mainName}` : null].filter(Boolean).join(" · ") || undefined}
        >
          <span className="doc-project">{state.projectName}</span>
          <span className="doc-name">{state.fileName}</span>
          {state.isMain ? <span className="main-badge">Main</span> : null}
          {state.unsaved ? (
            <span className="unsaved-dot" role="img" aria-label="Unsaved changes" title="Unsaved changes" />
          ) : null}
        </div>

        <span
          className={`compile-status ${state.statusClass}`}
          role="status"
          aria-live="polite"
          title={state.statusDetail ?? undefined}
        >
          {state.statusLabel}
        </span>
        <button
          className="primary compile-button"
          type="button"
          title="Compile (F5)"
          disabled={state.compiling || state.readOnly}
          onClick={actions.onCompile}
        >
          {state.compiling ? "Compiling" : "Compile"}
        </button>
      </div>

      {RIBBON_TABS.map((name) => (
        <div
          key={name}
          id={panelId(name)}
          role="tabpanel"
          aria-labelledby={tabId(name)}
          className="ribbon-panel"
          hidden={tab !== name}
        >
          {tab === name ? renderPanel(name) : null}
        </div>
      ))}
    </header>
  );

  function renderPanel(name: RibbonTab): ReactNode {
    switch (name) {
      case "file":
        return (
          <>
            <Group label="Project">
              <RibbonButton icon="new" label="New project" onClick={actions.onNewProject} />
              <RibbonButton icon="open" label="Open folder…" shortcut="Ctrl+O" onClick={actions.onOpen} />
              <MenuButton
                label="Recent projects"
                icon="recent"
                items={
                  state.recent.length
                    ? state.recent.map((project) => ({ label: project.name, detail: project.path, onSelect: () => actions.onRecent(project.path) }))
                    : [{ label: "No other projects yet", onSelect: () => undefined }]
                }
              />
              <RibbonButton icon="home" label="Project Home" onClick={actions.onHome} />
            </Group>
            <Group label="File">
              <RibbonButton icon="new" label="New file" shortcut="Ctrl+N" disabled={state.readOnly} onClick={actions.onNew} />
              <RibbonButton icon="save" label="Save" shortcut="Ctrl+S" disabled={state.readOnly} onClick={actions.onSave} />
              <RibbonButton icon="saveAs" label="Save as" shortcut="Ctrl+Shift+S" disabled={state.readOnly} onClick={actions.onSaveAs} />
            </Group>
          </>
        );
      case "home":
        return (
          <>
            <Group label="Font">
              <div className="font-controls">
                <div className="font-row">
                  <FontPicker value={state.settings.font} managed={state.settingsManaged} onChange={actions.onFont} />
                  <select
                    className="size-select"
                    aria-label="Font size"
                    title="Base font size"
                    value={state.settings.size}
                    onChange={(event) => actions.onSize(Number(event.target.value) as FontSize)}
                  >
                    {[10, 11, 12].map((size) => (
                      <option key={size} value={size}>
                        {size} pt
                      </option>
                    ))}
                  </select>
                </div>
                <div className="font-row">
                  <SmallButton icon="bold" label="Bold" shortcut="Ctrl+B" onClick={() => actions.onFormat("textbf")} />
                  <SmallButton icon="italic" label="Italic" shortcut="Ctrl+I" onClick={() => actions.onFormat("textit")} />
                  <SmallButton icon="underline" label="Underline" shortcut="Ctrl+U" onClick={() => actions.onFormat("underline")} />
                </div>
              </div>
            </Group>
            <Group label="Paragraph">
              <RibbonButton icon="bullets" label="Bullets" onClick={() => actions.onList("itemize")} />
              <RibbonButton icon="numbering" label="Numbering" onClick={() => actions.onList("enumerate")} />
            </Group>
            <Group label="Styles">
              <MenuButton
                label="Styles"
                icon="styles"
                items={[
                  { label: "Normal", onSelect: () => actions.onHeading(0) },
                  { label: "Heading 1", detail: "\\section", onSelect: () => actions.onHeading(1) },
                  { label: "Heading 2", detail: "\\subsection", onSelect: () => actions.onHeading(2) },
                  { label: "Heading 3", detail: "\\subsubsection", onSelect: () => actions.onHeading(3) },
                ]}
              />
            </Group>
          </>
        );
      case "insert":
        return (
          <>
            <Group label="Math">
              <RibbonButton icon="equation" label="Equation" onClick={actions.onEquation} />
            </Group>
            <Group label="Tables">
              <TablePicker onInsert={actions.onTable} />
            </Group>
            <Group label="Pages">
              <RibbonButton icon="pageBreak" label="Page break" onClick={actions.onPageBreak} />
            </Group>
            <Group label="References">
              <RibbonButton icon="footnote" label="Footnote" onClick={actions.onFootnote} />
            </Group>
          </>
        );
      case "layout":
        return (
          <Group label="Page setup">
            <LayoutMenu settings={state.settings} onChange={actions.onLayout} />
          </Group>
        );
      case "view":
        return (
          <>
            <Group label="Show">
              <RibbonButton icon="files" label="Files" shortcut="Ctrl+Shift+E" pressed={state.filesOpen} onClick={actions.onToggleFiles} />
            </Group>
            <Group label="Preview">
              <RibbonButton icon="preview" label="Live preview" pressed={state.liveEnabled} disabled={state.readOnly} onClick={actions.onToggleLive} />
              <RibbonButton icon="compile" label="Compile now" shortcut="F5" disabled={state.compiling || state.readOnly} onClick={actions.onCompile} />
              <RibbonButton icon="showInPdf" label="Show in PDF" shortcut="Ctrl+J" onClick={actions.onShowInPdf} />
            </Group>
            <Group label={`Zoom (${state.zoomLabel})`}>
              <RibbonButton icon="zoomOut" label="Zoom out" shortcut="Ctrl+-" onClick={() => actions.onZoom("out")} />
              <RibbonButton icon="fitWidth" label="Fit width" shortcut="Ctrl+0" pressed={state.zoomLabel === "Fit"} onClick={() => actions.onZoom("fit")} />
              <RibbonButton icon="zoomIn" label="Zoom in" shortcut="Ctrl+=" onClick={() => actions.onZoom("in")} />
            </Group>
            <Group label="Output">
              <RibbonButton
                icon="logs"
                label={state.logsOpen ? "Hide logs" : "Show logs"}
                shortcut="Ctrl+L"
                pressed={state.logsOpen}
                onClick={actions.onToggleLogs}
              />
            </Group>
          </>
        );
      case "git": {
        const git = state.git;
        const repo = !!git?.installed && git.repo !== "none";
        const write = repo && !state.readOnly;
        const remote = write && !!git?.remoteUrl;
        return (
          <>
            <Group label="History">
              {repo ? (
                <RibbonButton icon="commit" label="Commit" shortcut="Ctrl+Shift+K" disabled={!write} onClick={() => actions.onGit("commit")} />
              ) : (
                <RibbonButton icon="git" label="Start version history" disabled={!git?.installed || state.readOnly} onClick={() => actions.onGit("init")} />
              )}
              <RibbonButton icon="recent" label="History" disabled={!repo} onClick={() => actions.onGit("history")} />
              <RibbonButton icon="git" label="Git panel" shortcut="Ctrl+Shift+G" pressed={state.gitOpen} onClick={() => actions.onGit("changes")} />
            </Group>
            <Group label="Online">
              <RibbonButton icon="publish" label="Publish to GitHub" disabled={!write || !!git?.remoteUrl} onClick={() => actions.onGit("publish")} />
              <RibbonButton icon="link" label="Connect…" disabled={!write} onClick={() => actions.onGit("connect")} />
              <RibbonButton icon="push" label="Push" disabled={!remote} onClick={() => actions.onGit("push")} />
              <RibbonButton icon="pull" label="Pull" disabled={!remote} onClick={() => actions.onGit("pull")} />
              <RibbonButton icon="sync" label="Sync" disabled={!remote} onClick={() => actions.onGit("sync")} />
            </Group>
          </>
        );
      }
    }
  }
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ribbon-group" role="group" aria-label={label}>
      <div className="ribbon-group-items">{children}</div>
      <div className="ribbon-group-caption" aria-hidden="true">
        {label}
      </div>
    </div>
  );
}

function RibbonButton({
  icon,
  label,
  shortcut,
  pressed,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ribbon-button"
      aria-label={label}
      aria-pressed={pressed}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span className="ribbon-label" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

function SmallButton({ icon, label, shortcut, onClick }: { icon: IconName; label: string; shortcut: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-button" aria-label={label} title={`${label} (${shortcut})`} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}
