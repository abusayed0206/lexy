import { useLayoutEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { nextPlaceholder, PALETTE, PLACEHOLDER, type EquationMode } from "../latex/equations";
import { Dialog } from "./Dialog";

export type EquationResult = { tex: string; mode: EquationMode };

type Props = {
  initialTex?: string;
  initialMode?: EquationMode;
  editing?: boolean;
  onInsert: (result: EquationResult) => void;
  onClose: () => void;
};

type Render = { ok: true; html: string } | { ok: false; message: string };

function render(tex: string, mode: EquationMode): Render | null {
  if (!tex.trim()) return null;
  try {
    // Placeholders preview as empty boxes.
    const html = katex.renderToString(tex.split(PLACEHOLDER).join("\\square"), {
      throwOnError: true,
      displayMode: mode === "display",
      strict: "ignore",
    });
    return { ok: true, html };
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^KaTeX parse error: /, "") : String(error);
    return { ok: false, message };
  }
}

/** Equation editor: palette + text field + instant KaTeX preview (research R7). */
export default function EquationDialog({ initialTex = "", initialMode = "display", editing = false, onInsert, onClose }: Props) {
  const [tex, setTex] = useState(initialTex);
  const [mode, setMode] = useState<EquationMode>(initialMode);
  const field = useRef<HTMLTextAreaElement>(null);
  const preview = useMemo(() => render(tex, mode), [tex, mode]);
  /** Where a just-inserted snippet starts; its first placeholder is selected once the new value is rendered. */
  const pendingSelection = useRef<{ start: number; length: number } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingSelection.current;
    if (!pending) return;
    pendingSelection.current = null;
    const area = field.current;
    if (!area) return;
    area.focus();
    // Only a placeholder inside the inserted snippet; otherwise put the cursor after it.
    const index = tex.indexOf(PLACEHOLDER, pending.start);
    if (index >= 0 && index < pending.start + pending.length) area.setSelectionRange(index, index + PLACEHOLDER.length);
    else area.setSelectionRange(pending.start + pending.length, pending.start + pending.length);
  }, [tex]);

  function selectPlaceholder(text: string, from: number) {
    const index = nextPlaceholder(text, from);
    const area = field.current;
    if (!area) return false;
    area.focus();
    if (index < 0) return false;
    area.setSelectionRange(index, index + PLACEHOLDER.length);
    return true;
  }

  function insertSnippet(snippet: string) {
    const area = field.current;
    const start = area?.selectionStart ?? tex.length;
    const end = area?.selectionEnd ?? tex.length;
    pendingSelection.current = { start, length: snippet.length };
    setTex(tex.slice(0, start) + snippet + tex.slice(end));
  }

  const submit = () => tex.trim() && onInsert({ tex, mode });

  return (
    <Dialog
      title={editing ? "Edit equation" : "Equation"}
      onClose={onClose}
      wide
      actions={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!tex.trim()} onClick={submit}>
            {editing ? "Update" : "Insert"}
          </button>
        </>
      }
    >
      <div className="palette" aria-label="Symbols">
        {PALETTE.map((group) => (
          <div key={group.group} className="palette-group" role="group" aria-label={group.group}>
            <div className="palette-caption">{group.group}</div>
            <div className="palette-items">
              {group.items.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className="palette-item"
                  aria-label={item.name}
                  title={`${item.name}: ${item.tex}`}
                  onClick={() => insertSnippet(item.tex)}
                >
                  {group.group === "Greek" ? renderLabel(item.tex) : item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <label className="field equation-field">
        <span>LaTeX math</span>
        <textarea
          ref={field}
          data-autofocus
          rows={3}
          spellCheck={false}
          value={tex}
          placeholder="e.g. \frac{a}{b} or pick a symbol above"
          onChange={(event) => setTex(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.ctrlKey) {
              event.preventDefault();
              submit();
            } else if (event.key === "Tab" && !event.shiftKey && tex.includes(PLACEHOLDER)) {
              event.preventDefault();
              selectPlaceholder(tex, event.currentTarget.selectionEnd);
            }
          }}
        />
      </label>

      <div className="equation-preview" role="region" aria-label="Equation preview" aria-live="polite">
        {preview === null ? (
          <span className="muted">Preview appears here</span>
        ) : preview.ok ? (
          <span dangerouslySetInnerHTML={{ __html: preview.html }} />
        ) : (
          <span className="field-error">Can't preview: {preview.message}</span>
        )}
      </div>

      <fieldset className="mode-choice">
        <legend>Placement</legend>
        <label className="check">
          <input type="radio" name="equation-mode" checked={mode === "inline"} onChange={() => setMode("inline")} />
          Inline (in the sentence)
        </label>
        <label className="check">
          <input type="radio" name="equation-mode" checked={mode === "display"} onChange={() => setMode("display")} />
          Display (own line, numbered)
        </label>
      </fieldset>
    </Dialog>
  );
}

function renderLabel(tex: string) {
  try {
    return <span dangerouslySetInnerHTML={{ __html: katex.renderToString(tex, { throwOnError: true }) }} />;
  } catch {
    return tex;
  }
}
