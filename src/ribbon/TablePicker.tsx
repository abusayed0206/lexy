import { useState } from "react";
import { DEFAULT_TABLE, MAX_COLS, MAX_ROWS, validateTable, type TableSpec } from "../latex/tables";
import { Dialog } from "./Dialog";
import { MenuButton } from "./Menu";

export const GRID_COLS = 10;
export const GRID_ROWS = 8;

type Props = { onInsert: (spec: TableSpec) => void };

/** Word-style table button: hover/arrow over a 10×8 grid, or open "Insert table…". */
export function TablePicker({ onInsert }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <MenuButton label="Table" icon="table" items={[{ label: "Insert table…", onSelect: () => setDialogOpen(true) }]}>
        {(close) => (
          <TableGrid
            onPick={(cols, rows) => {
              close();
              onInsert({ ...DEFAULT_TABLE, cols, rows });
            }}
          />
        )}
      </MenuButton>
      {dialogOpen ? (
        <TableDialog
          onCancel={() => setDialogOpen(false)}
          onInsert={(spec) => {
            setDialogOpen(false);
            onInsert(spec);
          }}
        />
      ) : null}
    </>
  );
}

export function TableGrid({ onPick }: { onPick: (cols: number, rows: number) => void }) {
  const [size, setSize] = useState({ cols: 1, rows: 1 });
  const caption = `${size.cols} x ${size.rows} Table`;

  return (
    <div className="table-grid-wrap">
      <div
        className="table-grid"
        role="grid"
        aria-label="Table size"
        aria-describedby="table-grid-caption"
        tabIndex={0}
        onKeyDown={(event) => {
          const move: Record<string, [number, number]> = {
            ArrowRight: [1, 0],
            ArrowLeft: [-1, 0],
            ArrowDown: [0, 1],
            ArrowUp: [0, -1],
          };
          if (move[event.key]) {
            event.preventDefault();
            event.stopPropagation();
            const [dc, dr] = move[event.key];
            setSize((current) => ({
              cols: Math.min(GRID_COLS, Math.max(1, current.cols + dc)),
              rows: Math.min(GRID_ROWS, Math.max(1, current.rows + dr)),
            }));
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onPick(size.cols, size.rows);
          }
        }}
      >
        {Array.from({ length: GRID_ROWS }, (_, row) => (
          <div role="row" key={row} className="table-grid-row">
            {Array.from({ length: GRID_COLS }, (_, col) => {
              const selected = col < size.cols && row < size.rows;
              return (
                <div
                  key={col}
                  role="gridcell"
                  aria-selected={selected}
                  aria-label={`${col + 1} x ${row + 1}`}
                  className={selected ? "table-cell selected" : "table-cell"}
                  onMouseEnter={() => setSize({ cols: col + 1, rows: row + 1 })}
                  onClick={() => onPick(col + 1, row + 1)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="table-grid-caption" id="table-grid-caption" aria-live="polite">
        {caption}
      </div>
    </div>
  );
}

export function TableDialog({ onInsert, onCancel }: { onInsert: (spec: TableSpec) => void; onCancel: () => void }) {
  const [cols, setCols] = useState(String(DEFAULT_TABLE.cols));
  const [rows, setRows] = useState(String(DEFAULT_TABLE.rows));
  const [header, setHeader] = useState(DEFAULT_TABLE.header);
  const [borders, setBorders] = useState(DEFAULT_TABLE.borders);
  const [align, setAlign] = useState<TableSpec["align"]>(DEFAULT_TABLE.align);
  const [caption, setCaption] = useState("");

  const colsError = validateTable({ rows: 1, cols: Number(cols) }) && cols !== "" ? `Columns: 1 to ${MAX_COLS}` : cols === "" ? "Required" : null;
  const rowsError = validateTable({ rows: Number(rows), cols: 1 }) && rows !== "" ? `Rows: 1 to ${MAX_ROWS}` : rows === "" ? "Required" : null;
  const valid = !colsError && !rowsError;

  return (
    <Dialog
      title="Insert table"
      onClose={onCancel}
      actions={
        <>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!valid}
            onClick={() => onInsert({ cols: Number(cols), rows: Number(rows), header, borders, align, caption: caption.trim() })}
          >
            Insert
          </button>
        </>
      }
    >
      <div className="field-grid">
        <label className="field">
          <span>Columns</span>
          <input
            type="number"
            min={1}
            max={MAX_COLS}
            value={cols}
            data-autofocus
            aria-invalid={!!colsError}
            aria-describedby={colsError ? "cols-error" : undefined}
            onChange={(event) => setCols(event.target.value)}
          />
        </label>
        {colsError ? <small className="field-error" id="cols-error">{colsError}</small> : null}
        <label className="field">
          <span>Rows</span>
          <input
            type="number"
            min={1}
            max={MAX_ROWS}
            value={rows}
            aria-invalid={!!rowsError}
            aria-describedby={rowsError ? "rows-error" : undefined}
            onChange={(event) => setRows(event.target.value)}
          />
        </label>
        {rowsError ? <small className="field-error" id="rows-error">{rowsError}</small> : null}
        <label className="field">
          <span>Alignment</span>
          <select value={align} onChange={(event) => setAlign(event.target.value as TableSpec["align"])}>
            <option value="l">Left</option>
            <option value="c">Center</option>
            <option value="r">Right</option>
          </select>
        </label>
        <label className="field">
          <span>Caption (optional)</span>
          <input type="text" value={caption} onChange={(event) => setCaption(event.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={header} onChange={(event) => setHeader(event.target.checked)} />
          Header row
        </label>
        <label className="check">
          <input type="checkbox" checked={borders} onChange={(event) => setBorders(event.target.checked)} />
          Borders
        </label>
      </div>
    </Dialog>
  );
}
