import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { FontChoice } from "./latex/fonts";
import type { DocumentSettings, FontSize } from "./latex/settings";
import type { TableSpec } from "./latex/tables";
import { FontPicker } from "./ribbon/FontPicker";
import { Icon, type IconName } from "./ribbon/icons";
import { LayoutMenu } from "./ribbon/LayoutMenu";
import { MenuButton } from "./ribbon/Menu";
import { TablePicker } from "./ribbon/TablePicker";

export const RIBBON_TABS = ["file", "home", "insert", "layout", "view"] as const;
export type RibbonTab = (typeof RIBBON_TABS)[number];
const TAB_LABELS: Record<RibbonTab, string> = { file: "File", home: "Home", insert: "Insert", layout: "Layout", view: "View" };
const TAB_KEY = "lexy.ribbonTab";

export type RibbonActions = {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCompile: () => void;
  onToggleLogs: () => void;
  onToggleLive: () => void;
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
};

export type RibbonState = {
  fileName: string;
  path: string | null;
  unsaved: boolean;
  statusLabel: string;
  statusClass: string;
  statusDetail: string | null;
  compiling: boolean;
  logsOpen: boolean;
  liveEnabled: boolean;
  settings: DocumentSettings;
  settingsManaged: boolean;
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
  const tabRefs = useRef<Record<RibbonTab, HTMLButtonElement | null>>({ file: null, home: null, insert: null, layout: null, view: null });
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

        <div className="doc-title" title={state.path ?? "Not saved yet"}>
          <span className="doc-name">{state.fileName}</span>
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
          disabled={state.compiling}
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
          <Group label="Document">
            <RibbonButton icon="new" label="New" shortcut="Ctrl+N" onClick={actions.onNew} />
            <RibbonButton icon="open" label="Open" shortcut="Ctrl+O" onClick={actions.onOpen} />
            <RibbonButton icon="save" label="Save" shortcut="Ctrl+S" onClick={actions.onSave} />
            <RibbonButton icon="saveAs" label="Save as" shortcut="Ctrl+Shift+S" onClick={actions.onSaveAs} />
          </Group>
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
            <Group label="Preview">
              <RibbonButton icon="preview" label="Live preview" pressed={state.liveEnabled} onClick={actions.onToggleLive} />
              <RibbonButton icon="compile" label="Compile now" shortcut="F5" disabled={state.compiling} onClick={actions.onCompile} />
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
