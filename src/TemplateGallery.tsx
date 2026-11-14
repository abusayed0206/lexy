import { useState } from "react";
import { Dialog } from "./ribbon/Dialog";
import { INVALID_NAME_MESSAGE, validName } from "./projects";
import { TEMPLATES, type Template } from "./templates";

type GalleryProps = { value: string; onChange: (id: string) => void; disabled?: boolean };

/** Template choice for New project (spec 007 US3): a radio group, Blank first and selected by default. */
export function TemplateGallery({ value, onChange, disabled }: GalleryProps) {
  return (
    <fieldset className="template-gallery" disabled={disabled}>
      <legend>Start from</legend>
      {TEMPLATES.map((template) => (
        <label key={template.id} className={template.id === value ? "template-option selected" : "template-option"}>
          <input type="radio" name="template" value={template.id} checked={template.id === value} onChange={() => onChange(template.id)} />
          <span className="template-name">{template.name}</span>
          <span className="template-description">{template.description}</span>
        </label>
      ))}
    </fieldset>
  );
}

export const templateText = (id: string): string => (TEMPLATES.find((template) => template.id === id) ?? TEMPLATES[0]).text;

type DialogProps = { onCreate: (name: string, template: Template) => void; onClose: () => void };

/** File → New project from inside a project: name plus template. */
export function NewProjectDialog({ onCreate, onClose }: DialogProps) {
  const [name, setName] = useState("Untitled");
  const [template, setTemplate] = useState("blank");
  const [error, setError] = useState<string | null>(null);

  function create() {
    const trimmed = name.trim();
    if (!validName(trimmed)) {
      setError(INVALID_NAME_MESSAGE);
      return;
    }
    onCreate(trimmed, TEMPLATES.find((item) => item.id === template) ?? TEMPLATES[0]);
  }

  return (
    <Dialog
      title="New project"
      onClose={onClose}
      wide
      actions={
        <>
          <button type="button" className="primary" onClick={create}>
            Create
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <label className="field">
          <span>Project name</span>
          <input
            data-autofocus
            value={name}
            aria-invalid={error !== null}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </label>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <TemplateGallery value={template} onChange={setTemplate} />
      </form>
    </Dialog>
  );
}
