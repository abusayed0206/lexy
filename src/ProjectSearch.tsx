import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { InvalidPattern, searchProject, type FileHits, type SearchOptions } from "./latex/search";

type Props = {
  /** Every project text file with unsaved edits applied (path → text). */
  getTexts: () => Map<string, string>;
  readOnly: boolean;
  /** Bumped when texts change, so open results refresh. */
  version: number;
  onOpen: (file: string, from: number, to: number) => void;
  onReplaceAll: (query: string, options: SearchOptions, replacement: string, files: string[]) => void;
};

/** Ctrl+Shift+F: find (and replace) in every project file, grouped by file (spec 007 R13). */
export function ProjectSearch({ getTexts, readOnly, version, onOpen, onReplaceAll }: Props) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState<SearchOptions>({ matchCase: false, wholeWord: false, regex: false });
  const [results, setResults] = useState<FileHits[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const found = searchProject(getTexts(), query, options);
        setResults(found.results);
        setTruncated(found.truncated);
        setError(null);
      } catch (failure) {
        setResults([]);
        setError(failure instanceof InvalidPattern ? failure.message : String(failure));
      }
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, options, version]);

  const toggle = (key: keyof SearchOptions) => setOptions((current) => ({ ...current, [key]: !current[key] }));
  const total = results.reduce((sum, file) => sum + file.hits.length, 0);

  function onFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "c") toggle("matchCase");
    else if (key === "w") toggle("wholeWord");
    else if (key === "r") toggle("regex");
    else return;
    event.preventDefault();
  }

  return (
    <div className="project-search">
      <div className="search-fields">
        <input
          ref={input}
          aria-label="Find in project"
          placeholder="Find in project"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onFieldKeyDown}
          aria-invalid={error !== null}
          aria-describedby={error ? "search-error" : undefined}
        />
        <div className="search-options" role="group" aria-label="Search options">
          <button type="button" className="search-toggle" aria-pressed={options.matchCase} title="Match case (Alt+C)" onClick={() => toggle("matchCase")}>
            Aa
          </button>
          <button type="button" className="search-toggle" aria-pressed={options.wholeWord} title="Whole word (Alt+W)" onClick={() => toggle("wholeWord")}>
            ab
          </button>
          <button type="button" className="search-toggle" aria-pressed={options.regex} title="Regular expression (Alt+R)" onClick={() => toggle("regex")}>
            .*
          </button>
        </div>
        {error ? (
          <p id="search-error" className="search-error" role="alert">
            {error}
          </p>
        ) : null}
        <input
          aria-label="Replace with"
          placeholder="Replace with"
          value={replacement}
          disabled={readOnly}
          onChange={(event) => setReplacement(event.target.value)}
          onKeyDown={onFieldKeyDown}
        />
        <button
          type="button"
          disabled={readOnly || !total || error !== null}
          title={readOnly ? "This project is open read-only" : "Replace in every file; each file gets one undo step and stays unsaved"}
          onClick={() => onReplaceAll(query, options, replacement, results.map((file) => file.file))}
        >
          Replace all
        </button>
      </div>
      <p className="search-summary" role="status">
        {query && !error
          ? total
            ? `${total}${truncated ? "+" : ""} ${total === 1 ? "match" : "matches"} in ${results.length} ${results.length === 1 ? "file" : "files"}`
            : "No matches"
          : ""}
      </p>
      <ul className="search-results" aria-label="Search results">
        {results.map((file) => (
          <li key={file.file}>
            <div className="search-file">
              <span>{file.file}</span>
              <span className="search-count">{file.hits.length}</span>
            </div>
            <ul>
              {file.hits.slice(0, 200).map((hit) => (
                <li key={hit.from}>
                  <button type="button" className="search-hit" onClick={() => onOpen(file.file, hit.from, hit.to)} title={`Line ${hit.line}`}>
                    <span className="search-line">{hit.line}</span>
                    <span className="search-preview">
                      {hit.preview.slice(0, hit.previewFrom)}
                      <mark>{hit.preview.slice(hit.previewFrom, hit.previewTo)}</mark>
                      {hit.preview.slice(hit.previewTo)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
