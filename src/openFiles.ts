import { isWithin, sameRel } from "./projects";

/** One text file loaded during this session (data-model.md OpenFile). */
export type OpenFile = {
  /** Text last read from or written to disk. */
  savedText: string;
  /** Current editor text. */
  text: string;
  /** The file changed on disk while it had unsaved edits ("Reload / Keep mine"). */
  diskChanged: boolean;
};

export type OpenFilesState = {
  files: ReadonlyMap<string, OpenFile>;
  current: string | null;
  main: string | null;
};

export type OpenFilesEvent =
  /** `background`: load without showing it (Replace all in files that weren't open). */
  | { type: "opened"; path: string; text: string; background?: boolean }
  | { type: "switched"; path: string }
  | { type: "edited"; path: string; text: string }
  | { type: "saved"; path: string; text: string }
  | { type: "diskChanged"; path: string }
  | { type: "reloaded"; path: string; text: string }
  | { type: "keptMine"; path: string }
  | { type: "renamed"; from: string; to: string }
  | { type: "deleted"; path: string }
  | { type: "closed"; path: string }
  /** Move a tab; `index` is its new position among the open files (Map order = tab order). */
  | { type: "reordered"; path: string; index: number }
  | { type: "mainSet"; path: string | null };

export const emptyOpenFiles: OpenFilesState = { files: new Map(), current: null, main: null };

export const isDirty = (file: OpenFile | undefined) => !!file && file.text !== file.savedText;

/** Paths with unsaved edits, current file first. */
export function dirtyFiles(state: OpenFilesState): string[] {
  const dirty = [...state.files].filter(([, file]) => isDirty(file)).map(([path]) => path);
  return dirty.sort((a, b) => Number(b === state.current) - Number(a === state.current));
}

/** The key under which `path` is stored (paths are case-insensitive on Windows). */
export function keyOf(state: OpenFilesState, path: string): string | undefined {
  for (const key of state.files.keys()) if (sameRel(key, path)) return key;
  return undefined;
}

function update(state: OpenFilesState, path: string, change: (file: OpenFile) => OpenFile): OpenFilesState {
  const key = keyOf(state, path);
  if (key === undefined) return state;
  const files = new Map(state.files);
  files.set(key, change(files.get(key)!));
  return { ...state, files };
}

/** `from\x` → `to\x` for a renamed file or folder. */
function moved(path: string | null, from: string, to: string): string | null {
  if (path === null || !isWithin(path, from)) return path;
  return to + path.slice(from.length);
}

export function openFilesReducer(state: OpenFilesState, event: OpenFilesEvent): OpenFilesState {
  switch (event.type) {
    case "opened": {
      const key = keyOf(state, event.path);
      if (key !== undefined) return event.background ? state : { ...state, current: key };
      const files = new Map(state.files);
      files.set(event.path, { savedText: event.text, text: event.text, diskChanged: false });
      return { ...state, files, current: event.background ? state.current : event.path };
    }
    case "switched": {
      const key = keyOf(state, event.path);
      return key === undefined || key === state.current ? state : { ...state, current: key };
    }
    case "edited":
      return update(state, event.path, (file) => (file.text === event.text ? file : { ...file, text: event.text }));
    case "saved":
      return update(state, event.path, (file) => ({ ...file, savedText: event.text, diskChanged: false }));
    case "diskChanged":
      return update(state, event.path, (file) => (isDirty(file) ? { ...file, diskChanged: true } : file));
    case "reloaded":
      return update(state, event.path, () => ({ savedText: event.text, text: event.text, diskChanged: false }));
    case "keptMine":
      return update(state, event.path, (file) => ({ ...file, diskChanged: false }));
    case "renamed": {
      const files = new Map<string, OpenFile>();
      for (const [path, file] of state.files) files.set(moved(path, event.from, event.to)!, file);
      return { files, current: moved(state.current, event.from, event.to), main: moved(state.main, event.from, event.to) };
    }
    case "deleted": {
      const files = new Map([...state.files].filter(([path]) => !isWithin(path, event.path)));
      const main = state.main !== null && isWithin(state.main, event.path) ? null : state.main;
      const lost = state.current !== null && isWithin(state.current, event.path);
      return { files, main, current: lost ? (main !== null && files.has(main) ? main : null) : state.current };
    }
    case "closed": {
      const key = keyOf(state, event.path);
      if (key === undefined || sameRel(key, state.main)) return state; // the main document can't be closed
      // Closing the shown tab shows its right neighbour, else its left one (Windows TabView rule).
      const order = [...state.files.keys()];
      const at = order.indexOf(key);
      const files = new Map(state.files);
      files.delete(key);
      const neighbour = order[at + 1] ?? order[at - 1] ?? null;
      const current = key === state.current ? neighbour : state.current;
      return { ...state, files, current };
    }
    case "reordered": {
      const key = keyOf(state, event.path);
      if (key === undefined) return state;
      const order = [...state.files.keys()].filter((path) => path !== key);
      order.splice(Math.max(0, Math.min(event.index, order.length)), 0, key);
      return { ...state, files: new Map(order.map((path) => [path, state.files.get(path)!])) };
    }
    case "mainSet":
      return { ...state, main: event.path };
  }
}
