import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { FontChoice } from "./latex/fonts";
import type { DocumentSettings, FontSize } from "./latex/settings";
import type { TableSpec } from "./latex/tables";
import { FontPicker } from "./ribbon/FontPicker";
import { Icon, type IconName } from "./ribbon/icons";
import { LayoutMenu } from "./ribbon/LayoutMenu";
import { EngineMenu } from "./ribbon/EngineMenu";
import type { EngineChoice } from "./latex/engine";
import { MenuButton } from "./ribbon/Menu";
import { TablePicker } from "./ribbon/TablePicker";
import type { GitState } from "./git";
import type { GitAction } from "./GitPanel";

export const RIBBON_TABS = ["file", "home", "insert", "layout", "review", "view", "git"] as const;
export type RibbonTab = (typeof RIBBON_TABS)[number];
/** Ribbon access keys (Windows/Word precedents): Alt, then the letter, opens the tab. */
export const ACCESS_KEYS: Record<RibbonTab, string> = { file: "F", home: "H", insert: "N", layout: "P", review: "R", view: "W", git: "G" };
const TAB_LABELS: Record<RibbonTab, string> = { file: "File", home: "Home", insert: "Insert", layout: "Layout", review: "Review", view: "View", git: "Git" };
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
  /** Stop the running compile (spec 008 US2). */
  onStop: () => void;
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
  /** Layout → Engine (spec 008 US3). */
  onEngine: (choice: EngineChoice) => void;
  onGit: (action: GitAction) => void;
  /** Re-indent environments (Shift+Alt+F). */
  onTidy: () => void;
  /** On-demand grammar check (F7). */
  onGrammar: () => void;
  /** Focus mode (F11). */
  onToggleFocus: () => void;
  /** Earlier versions of the shown file (snapshots, or Git history). */
  onHistory: () => void;
  /** Insert → Citation. */
  onCitation: () => void;
  /** Insert → Image (copied into the project's image folder). */
  onImage: () => void;
  /** Review (spec 007 US4). */
  onNewNote: () => void;
  onShowNotes: () => void;
  onCompareLast: () => void;
  onCompareWith: () => void;
  onExportNotes: () => void;
  /** File → Settings (Ctrl+,). */
  onSettings: () => void;
  /** File → Export: Word document or web page (spec 007 US7). */
  onExport: (format: "docx" | "html") => void;
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
  /** Any compile (live or explicit) is running, so Stop is offered. */
  stoppable?: boolean;
  readOnly: boolean;
  logsOpen: boolean;
  liveEnabled: boolean;
  filesOpen: boolean;
  recent: { path: string; name: string }[];
  settings: DocumentSettings;
  /** The main document's engine line (spec 008 US3). */
  engine?: EngineChoice;
  /** "Last compile: XeLaTeX (fontspec package)", or null before the first compile. */
  lastEngine?: string | null;
  settingsManaged: boolean;
  git: GitState | null;
  gitOpen: boolean;
  /** "Fit" or "125 %". */
  zoomLabel: string;
  /** "1,234 words" or "56 of 1,234 words"; null without a main document. */
  wordCount?: string | null;
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

export function Ribbon({ actions, state, hidden = false }: { actions: RibbonActions; state: RibbonState; hidden?: boolean }) {
  const [tab, setTab] = useState<RibbonTab>(loadTab);
  const tabRefs = useRef<Record<RibbonTab, HTMLButtonElement | null>>({ file: null, home: null, insert: null, layout: null, review: null, view: null, git: null });
  const baseId = useId();
  const [keyTips, setKeyTips] = useState(false);

  // Alt pressed and released alone shows key tips; the next letter opens that tab (Esc or any other key hides them).
  // Alt+letter works directly too, except in text fields, where Alt+letters belong to the field (Find in project).
  useEffect(() => {
    if (hidden) return;
    let altAlone = false;
    const byLetter = (key: string) => RIBBON_TABS.find((name) => ACCESS_KEYS[name] === key.toUpperCase());
    const inTextField = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.("input, textarea, select, .cm-editor, .dialog");
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Alt") {
        altAlone = !event.repeat;
        return;
      }
      altAlone = false;
      if (keyTipsRef.current) {
        const target = byLetter(event.key);
        setKeyTips(false);
        if (target) {
          event.preventDefault();
          select(target, true);
        }
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.shiftKey && !inTextField(event.target)) {
        const target = byLetter(event.key);
        if (target) {
          event.preventDefault();
          select(target, true);
        }
      }
    }
    function onKeyUp(event: globalThis.KeyboardEvent) {
      if (event.key !== "Alt" || !altAlone) return;
      altAlone = false;
      event.preventDefault();
      setKeyTips((on) => !on);
    }
    const hide = () => setKeyTips(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerdown", hide);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerdown", hide);
      window.removeEventListener("blur", hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);
  const keyTipsRef = useRef(keyTips);
  keyTipsRef.current = keyTips;

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
    <header className="ribbon" hidden={hidden}>
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
              aria-keyshortcuts={`Alt+${ACCESS_KEYS[name]}`}
              tabIndex={tab === name ? 0 : -1}
              onClick={() => select(name)}
              onKeyDown={onTabKeyDown}
            >
              {TAB_LABELS[name]}
              {keyTips ? (
                <span className="key-tip" aria-hidden="true">
                  {ACCESS_KEYS[name]}
                </span>
              ) : null}
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

        {state.wordCount ? (
          <span className="word-count" aria-live="off" title="Words in the document and its included files (commands and math not counted)">
            {state.wordCount}
          </span>
        ) : null}
        <span
          className={`compile-status ${state.statusClass}`}
          role="status"
          aria-live="polite"
          title={state.statusDetail ?? undefined}
        >
          {state.statusLabel}
        </span>
        {state.stoppable ? (
          <button type="button" className="stop-button" title="Stop compile (Shift+F5)" aria-label="Stop compile (Shift+F5)" onClick={actions.onStop}>
            Stop
          </button>
        ) : null}
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
              <RibbonButton icon="recent" label="Earlier versions" onClick={actions.onHistory} />
            </Group>
            <Group label="Export">
              <MenuButton
                label="Export"
                icon="export"
                items={[
                  { label: "Word document (.docx)", onSelect: () => actions.onExport("docx") },
                  { label: "Web page (.html)", onSelect: () => actions.onExport("html") },
                ]}
              />
            </Group>
            <Group label="App">
              <RibbonButton icon="settings" label="Settings" shortcut="Ctrl+," onClick={actions.onSettings} />
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
            <Group label="Proofing">
              <RibbonButton icon="tidy" label="Tidy" shortcut="Shift+Alt+F" disabled={state.readOnly} onClick={actions.onTidy} />
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
            <Group label="Illustrations">
              <RibbonButton icon="image" label="Image" disabled={state.readOnly} onClick={actions.onImage} />
            </Group>
            <Group label="References">
              <RibbonButton icon="footnote" label="Footnote" onClick={actions.onFootnote} />
              <RibbonButton icon="citation" label="Citation" onClick={actions.onCitation} />
            </Group>
          </>
        );
      case "layout":
        return (
          <>
            <Group label="Page setup">
              <LayoutMenu settings={state.settings} onChange={actions.onLayout} />
            </Group>
            <Group label="Typesetting">
              <EngineMenu choice={state.engine ?? "auto"} lastCompile={state.lastEngine ?? null} disabled={state.readOnly} onChange={actions.onEngine} />
            </Group>
          </>
        );
      case "review":
        return (
          <>
            <Group label="Proofing">
              <RibbonButton icon="grammar" label="Check grammar" shortcut="F7" onClick={actions.onGrammar} />
            </Group>
            <Group label="Notes">
              <RibbonButton icon="note" label="New note" shortcut="Ctrl+Alt+M" disabled={state.readOnly} onClick={actions.onNewNote} />
              <RibbonButton icon="notes" label="Show notes" onClick={actions.onShowNotes} />
              <RibbonButton icon="pdfNotes" label="PDF with notes" disabled={state.readOnly} onClick={actions.onExportNotes} />
            </Group>
            <Group label="Compare">
              <RibbonButton icon="compare" label="Compare with last version" onClick={actions.onCompareLast} />
              <RibbonButton icon="recent" label="Compare with…" onClick={actions.onCompareWith} />
            </Group>
          </>
        );
      case "view":
        return (
          <>
            <Group label="Show">
              <RibbonButton icon="files" label="Files" shortcut="Ctrl+Shift+E" pressed={state.filesOpen} onClick={actions.onToggleFiles} />
              <RibbonButton icon="focus" label="Focus" shortcut="F11" onClick={actions.onToggleFocus} />
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
