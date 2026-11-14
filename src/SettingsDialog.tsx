import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import { INVALID_NAME_MESSAGE, validName } from "./projects";

type Props = {
  settings: Settings;
  update: (change: Partial<Settings>) => Promise<void> | void;
  onClose: () => void;
  /** App version for About; unknown in tests and the browser preview. */
  version?: string | null;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * File → Settings (Ctrl+,), laid out like a Windows settings page (DESIGN.md "Windows design
 * alignment"): one column, short section headers, toggles for on/off, changes apply at once.
 */
export function SettingsDialog({ settings, update, onClose, version = null }: Props) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("select, input, button")?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <section
      ref={box}
      className="settings-page dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="settings-column">
        <header className="settings-header">
          <button type="button" onClick={onClose}>
            Back
          </button>
          <h1>Settings</h1>
        </header>

        <Section title="Appearance">
          <Row label="Theme" description="Follow Windows, or always use light or dark.">
            {(id) => (
              <select id={id} value={settings.theme} onChange={(event) => void update({ theme: event.target.value as Settings["theme"] })}>
                <option value="system">Use system setting</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            )}
          </Row>
          <Row label="Editor font size" description="10 to 24 pixels.">
            {(id) => <NumberField id={id} value={settings.editorFontSize} min={10} max={24} onCommit={(value) => void update({ editorFontSize: value })} />}
          </Row>
        </Section>

        <Section title="Editing">
          <Toggle label="Vim keys" description="Normal, insert and visual modes in the editor." checked={settings.vim} onChange={(vim) => void update({ vim })} />
          <Toggle label="Auto-save" description="Save modified files after a pause in typing." checked={settings.autoSave} onChange={(autoSave) => void update({ autoSave })} />
          <Row label="Auto-save after" description="Seconds without typing (1 to 60)." disabled={!settings.autoSave}>
            {(id) => (
              <NumberField
                id={id}
                value={Math.round(settings.autoSaveDelayMs / 1000)}
                min={1}
                max={60}
                disabled={!settings.autoSave}
                onCommit={(seconds) => void update({ autoSaveDelayMs: seconds * 1000 })}
              />
            )}
          </Row>
          <Toggle label="Spelling" description="Underline misspelled words in the text (never in commands or math)." checked={settings.spellCheck} onChange={(spellCheck) => void update({ spellCheck })} />
          <Row label="Spelling language" description="More dictionaries can go in %LOCALAPPDATA%\Lexy\Dictionaries." disabled={!settings.spellCheck}>
            {(id) => (
              <select id={id} value={settings.spellLanguage} disabled={!settings.spellCheck} onChange={(event) => void update({ spellLanguage: event.target.value })}>
                {[...new Set(["en_US", settings.spellLanguage])].map((lang) => (
                  <option key={lang} value={lang}>
                    {lang === "en_US" ? "English (United States)" : lang}
                  </option>
                ))}
              </select>
            )}
          </Row>
        </Section>

        <Section title="Preview">
          <Row label="Live preview delay" description="Seconds after you stop typing (0.3 to 5).">
            {(id) => (
              <NumberField
                id={id}
                value={settings.livePreviewDelayMs / 1000}
                min={0.3}
                max={5}
                step={0.1}
                onCommit={(seconds) => void update({ livePreviewDelayMs: Math.round(seconds * 1000) })}
              />
            )}
          </Row>
          <Toggle label="Hide the PDF in focus mode" description="Focus mode (F11) shows only the editor." checked={settings.hidePdfInFocus} onChange={(hidePdfInFocus) => void update({ hidePdfInFocus })} />
        </Section>

        <Section title="Grammar">
          <Toggle
            label="Grammar check"
            description="Check grammar (F7) sends the shown file's text to the server below."
            checked={settings.grammarCheck}
            onChange={(grammarCheck) => void update({ grammarCheck })}
          />
          <Row label="Server" description="A LanguageTool server; https only. You can run your own.">
            {(id) => (
              <TextField
                id={id}
                value={settings.grammarServer}
                validate={(value) => (value.startsWith("https://") ? null : "Use an https:// address")}
                onCommit={(grammarServer) => void update({ grammarServer: grammarServer.replace(/\/+$/, "") })}
              />
            )}
          </Row>
        </Section>

        <Section title="Files">
          <Row label="Image folder" description="Inserted and dropped images are copied here, inside the project.">
            {(id) => (
              <TextField
                id={id}
                value={settings.imageFolder}
                validate={(value) => (validName(value) ? null : INVALID_NAME_MESSAGE)}
                onCommit={(imageFolder) => void update({ imageFolder })}
              />
            )}
          </Row>
        </Section>

        <Section title="About">
          <p className="settings-about">
            Lexy {version ?? ""}
            <br />
            Settings are stored in %LOCALAPPDATA%\Lexy\settings.json. The setup log is %LOCALAPPDATA%\Lexy\Setup\setup.log.
          </p>
          <button type="button" onClick={() => void update(DEFAULT_SETTINGS)}>
            Reset all settings
          </button>
        </Section>
      </div>
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="settings-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, description, disabled, children }: { label: string; description: string; disabled?: boolean; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={disabled ? "settings-row disabled" : "settings-row"}>
      <label htmlFor={id} className="settings-label">
        <span>{label}</span>
        <span className="settings-description">{description}</span>
      </label>
      <div className="settings-control">{children(id)}</div>
    </div>
  );
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <Row label={label} description={description}>
      {(id) => (
        <span className="settings-toggle">
          <input id={id} type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
          <span aria-hidden="true">{checked ? "On" : "Off"}</span>
        </span>
      )}
    </Row>
  );
}

/** A number applied on blur or Enter, clamped to its range. */
function NumberField({
  id,
  value,
  min,
  max,
  step = 1,
  disabled,
  onCommit,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  function commit() {
    const parsed = Number(draft.replace(",", "."));
    const next = Number.isFinite(parsed) ? clamp(parsed, min, max) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

/** Text applied on blur or Enter when valid; an invalid value shows its message and is not stored. */
function TextField({ id, value, validate, onCommit }: { id: string; value: string; validate: (value: string) => string | null; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(value), [value]);
  function commit() {
    const trimmed = draft.trim();
    const problem = validate(trimmed);
    setError(problem);
    if (!problem && trimmed !== value) onCommit(trimmed);
  }
  return (
    <span className="settings-text">
      <input
        id={id}
        value={draft}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
      {error ? (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
