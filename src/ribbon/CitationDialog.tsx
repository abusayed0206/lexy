import { useMemo, useState } from "react";
import { Dialog } from "./Dialog";
import type { BibEntry } from "../latex/index";

type Props = {
  entries: BibEntry[];
  /** The project has at least one .bib file. */
  hasBib: boolean;
  onInsert: (keys: string[]) => void;
  onAddByDoi: () => void;
  onCreateBib: () => void;
  onClose: () => void;
};

/** Insert → Citation (spec 007 US3): search the project's bibliography, pick one or more entries. */
export function CitationDialog({ entries, hasBib, onInsert, onAddByDoi, onCreateBib, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter((entry) => {
      const haystack = `${entry.key} ${entry.author} ${entry.title} ${entry.year}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [entries, query]);

  const toggle = (key: string) => setPicked((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));

  return (
    <Dialog
      title="Insert citation"
      onClose={onClose}
      wide
      actions={
        <>
          <button type="button" className="primary" disabled={!picked.length} onClick={() => onInsert(picked)}>
            Insert
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      {hasBib ? (
        <>
          <label className="field">
            <span>Search by author, title, year or key</span>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && shown.length === 1) {
                  event.preventDefault();
                  onInsert(picked.length ? picked : [shown[0].key]);
                }
              }}
            />
          </label>
          <ul className="citation-list" aria-label="Bibliography entries">
            {shown.map((entry) => (
              <li key={`${entry.file}:${entry.key}`}>
                <label>
                  <input type="checkbox" checked={picked.includes(entry.key)} onChange={() => toggle(entry.key)} />
                  <span className="citation-main">
                    <strong>{entry.title || entry.key}</strong>
                    <span className="citation-detail">
                      {[entry.author, entry.year].filter(Boolean).join(" · ")} — <code>{entry.key}</code>
                    </span>
                  </span>
                </label>
              </li>
            ))}
            {shown.length ? null : <li className="citation-empty">No matching entries</li>}
          </ul>
        </>
      ) : (
        <p>
          No bibliography yet.{" "}
          <button type="button" className="link-button" onClick={onCreateBib}>
            Create references.bib
          </button>
        </p>
      )}
      <p>
        <button type="button" className="link-button" onClick={onAddByDoi}>
          Add by DOI…
        </button>
      </p>
    </Dialog>
  );
}
