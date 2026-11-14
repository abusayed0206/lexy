import { useState } from "react";
import type { Note } from "./latex/notes";
import { baseName } from "./projects";

type Props = {
  notes: Note[];
  readOnly: boolean;
  onJump: (note: Note) => void;
  onState: (note: Note, state: Note["state"]) => void;
  onDelete: (note: Note) => void;
};

/** Notes on passages across the project (spec 007 US4); resolved ones hidden unless asked for. */
export function Notes({ notes, readOnly, onJump, onState, onDelete }: Props) {
  const [showResolved, setShowResolved] = useState(false);
  const shown = notes.filter((note) => showResolved || note.state !== "resolved");
  const resolved = notes.length - notes.filter((note) => note.state !== "resolved").length;

  return (
    <div className="notes">
      <label className="notes-filter">
        <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
        Show resolved ({resolved})
      </label>
      {shown.length ? (
        <ul className="notes-list" aria-label="Notes">
          {shown.map((note) => (
            <li key={note.id} className={`note-row note-${note.state}`}>
              <button type="button" className="note-jump" disabled={note.state === "detached"} onClick={() => onJump(note)} title={`${note.file} — go to the passage`}>
                <span className="note-quote">{note.state === "detached" ? "Text was removed" : `“${note.quote}”`}</span>
                <span className="note-body">{note.body}</span>
                <span className="note-meta">
                  {baseName(note.file)} · {new Date(note.created).toLocaleDateString()}
                  {note.state === "resolved" ? " · Resolved" : ""}
                </span>
              </button>
              <span className="note-actions">
                {note.state === "resolved" ? (
                  <button type="button" disabled={readOnly} onClick={() => onState(note, "open")}>
                    Reopen
                  </button>
                ) : (
                  <button type="button" disabled={readOnly} onClick={() => onState(note, "resolved")}>
                    Resolve
                  </button>
                )}
                <button type="button" disabled={readOnly} aria-label={`Delete note: ${note.body}`} onClick={() => onDelete(note)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="side-empty">{notes.length ? "All notes are resolved" : "No notes yet. Select text and press Ctrl+Alt+M."}</p>
      )}
    </div>
  );
}
