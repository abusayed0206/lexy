import { useState } from "react";
import {
  isValidMargin,
  MARGIN_PRESETS,
  marginPresetOf,
  MAX_MARGIN,
  MIN_MARGIN,
  type DocumentSettings,
  type MarginPreset,
  type Margins,
} from "../latex/settings";
import { Dialog } from "./Dialog";
import { MenuButton } from "./Menu";

type Props = {
  settings: DocumentSettings;
  onChange: (next: DocumentSettings) => void;
};

const PRESET_LABELS: Record<MarginPreset, string> = { normal: "Normal", narrow: "Narrow", moderate: "Moderate", wide: "Wide" };
const SIDES = ["top", "bottom", "left", "right"] as const;

function describe(margins: Margins): string {
  return `Top ${margins.top} cm, Bottom ${margins.bottom} cm, Left ${margins.left} cm, Right ${margins.right} cm`;
}

export function LayoutMenu({ settings, onChange }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const preset = marginPresetOf(settings.margins);

  return (
    <>
      <MenuButton
        label="Margins"
        icon="margins"
        items={[
          ...(Object.keys(MARGIN_PRESETS) as MarginPreset[]).map((key) => ({
            label: PRESET_LABELS[key],
            detail: describe(MARGIN_PRESETS[key]),
            checked: preset === key,
            onSelect: () => onChange({ ...settings, margins: MARGIN_PRESETS[key] }),
          })),
          { label: "Custom margins…", checked: preset === null, onSelect: () => setCustomOpen(true) },
        ]}
      />
      <MenuButton
        label="Size"
        icon="paper"
        items={[
          { label: "A4", detail: "21 × 29.7 cm", checked: settings.paper === "a4", onSelect: () => onChange({ ...settings, paper: "a4" }) },
          { label: "Letter", detail: "21.59 × 27.94 cm", checked: settings.paper === "letter", onSelect: () => onChange({ ...settings, paper: "letter" }) },
        ]}
      />
      <MenuButton
        label="Orientation"
        icon="orientation"
        items={[
          { label: "Portrait", checked: settings.orientation === "portrait", onSelect: () => onChange({ ...settings, orientation: "portrait" }) },
          { label: "Landscape", checked: settings.orientation === "landscape", onSelect: () => onChange({ ...settings, orientation: "landscape" }) },
        ]}
      />
      {customOpen ? (
        <MarginsDialog
          initial={settings.margins}
          onCancel={() => setCustomOpen(false)}
          onApply={(margins) => {
            setCustomOpen(false);
            onChange({ ...settings, margins });
          }}
        />
      ) : null}
    </>
  );
}

export function MarginsDialog({
  initial,
  onApply,
  onCancel,
}: {
  initial: Margins;
  onApply: (margins: Margins) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<(typeof SIDES)[number], string>>({
    top: String(initial.top),
    bottom: String(initial.bottom),
    left: String(initial.left),
    right: String(initial.right),
  });
  const parsed = Object.fromEntries(SIDES.map((side) => [side, Number(values[side])])) as Margins;
  const invalid = SIDES.filter((side) => values[side].trim() === "" || !isValidMargin(parsed[side]));

  return (
    <Dialog
      title="Custom margins"
      onClose={onCancel}
      actions={
        <>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={invalid.length > 0} onClick={() => onApply(parsed)}>
            Apply
          </button>
        </>
      }
    >
      <div className="field-grid">
        {SIDES.map((side, index) => {
          const error = invalid.includes(side);
          const errorId = `margin-${side}-error`;
          return (
            <div key={side} className="field">
              <label className="field-inner">
              <span>{side[0].toUpperCase() + side.slice(1)} (cm)</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min={MIN_MARGIN}
                max={MAX_MARGIN}
                value={values[side]}
                data-autofocus={index === 0 ? true : undefined}
                aria-invalid={error}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => setValues((current) => ({ ...current, [side]: event.target.value }))}
              />
              </label>
              {error ? (
                <small className="field-error" id={errorId}>
                  Between {MIN_MARGIN} and {MAX_MARGIN} cm
                </small>
              ) : null}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
