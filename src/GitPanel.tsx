import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatSize, parseDiff } from "./git/diff";
import {
  STATUS_LETTER,
  gitAbortMerge,
  gitCommit,
  gitConnectRemote,
  gitDiff,
  gitIgnore,
  gitInit,
  gitLog,
  gitLogFiles,
  gitPublishGithub,
  gitPull,
  gitPush,
  gitResolve,
  gitRestore,
  gitSetIdentity,
  gitShowFile,
  isGitError,
  webLink,
  type Change,
  type CommitInfo,
  type FileDiff,
  type GitState,
} from "./git";
import { relativeDate } from "./ProjectHome";
import type { Choice, Validate } from "./ProjectDialogs";
import { errorText } from "./projects";

export type GitAction = "init" | "commit" | "focus" | "changes" | "history" | "publish" | "connect" | "push" | "pull" | "sync";

type Props = {
  state: GitState | null;
  projectName: string;
  /** Latest ribbon/shortcut request; `seq` changes on every request. */
  request: { action: GitAction; seq: number } | null;
  refresh: () => Promise<void>;
  saveAll: () => Promise<boolean>;
  /** Called before a file is restored; false cancels (unsaved edits kept). */
  confirmRestoreFile: (path: string) => Promise<boolean>;
  /** Reload files from disk after Git changed them. */
  reloadFiles: (paths: string[] | "all") => Promise<void>;
  ask: <T extends string>(title: string, body: ReactNode, choices: Choice<T>[]) => Promise<T | null>;
  prompt: (title: string, label: string, initial: string, validate?: Validate) => Promise<string | null>;
  onClose: () => void;
};

type Result = { text: string; error?: boolean; pull?: boolean };
const GIT_DOWNLOAD = "https://git-scm.com/download/win";
const GH_DOWNLOAD = "https://cli.github.com/";
const PAGE = 50;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function stateLine(state: GitState | null): string {
  if (!state) return "Checking version history…";
  if (!state.installed) return "Git for Windows is needed for version history.";
  if (state.repo === "none") return "No history yet.";
  const conflicts = state.changes.filter((c) => c.status === "conflicted").length;
  if (conflicts) return `Conflicts in ${plural(conflicts, "file")}.`;
  const parts = [state.changes.length ? plural(state.changes.length, "change") : "Nothing to commit"];
  if (state.ahead) parts.push(`${state.ahead} to push`);
  if (state.behind) parts.push(`${state.behind} to pull`);
  return parts.join(" · ");
}

export function GitPanel({ state, projectName, request, refresh, saveAll, confirmRestoreFile, reloadFiles, ask, prompt, onClose }: Props) {
  const [view, setView] = useState<"changes" | "history">("changes");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [more, setMore] = useState(true);
  const [commit, setCommit] = useState<CommitInfo | null>(null);
  const [commitFiles, setCommitFiles] = useState<Change[]>([]);
  const [shown, setShown] = useState<{ title: string; text: string } | null>(null);
  const [signIn, setSignIn] = useState<{ code: string; url: string } | null>(null);
  const messageBox = useRef<HTMLTextAreaElement>(null);

  const repo = !!state?.installed && state.repo !== "none";
  const canWrite = repo && !state?.readOnly && !busy;
  const merging = !!state?.merging;
  const conflicts = state?.changes.filter((c) => c.status === "conflicted") ?? [];

  async function act(label: string, run: () => Promise<string | Result | void>) {
    setBusy(label);
    setResult(null);
    try {
      const outcome = await run();
      if (outcome) setResult(typeof outcome === "string" ? { text: outcome } : outcome);
    } catch (error) {
      setResult({ text: errorText(error), error: true, pull: isGitError(error, "rejected") });
    } finally {
      setBusy(null);
      setSignIn(null);
      await refresh();
    }
  }

  async function askIdentity(): Promise<boolean> {
    const name = await prompt("Your name for commits", "Name", "", (v) => (v ? null : "Enter a name."));
    if (name === null) return false;
    const email = await prompt("Your email for commits", "Email", "", (v) => (/^\S+@\S+$/.test(v) ? null : "Enter an email address."));
    if (email === null) return false;
    await gitSetIdentity(name, email);
    return true;
  }

  const init = () =>
    act("Starting history…", async () => {
      if (!(await saveAll())) return;
      for (;;) {
        try {
          await gitInit();
          return "Version history started.";
        } catch (error) {
          if (isGitError(error, "needsIdentity") && (await askIdentity())) continue;
          throw error;
        }
      }
    });

  const commitNow = () => {
    if (!message.trim()) {
      setResult({ text: "Write a short message first.", error: true });
      messageBox.current?.focus();
      return;
    }
    return act("Committing…", async () => {
      if (!(await saveAll())) return;
      let allowLarge = false;
      for (;;) {
        try {
          const done = await gitCommit(message, allowLarge);
          setMessage("");
          return `Committed: ${done.message}`;
        } catch (error) {
          if (isGitError(error, "needsIdentity") && (await askIdentity())) continue;
          if (isGitError(error, "largeFiles")) {
            const paths = error.message.split("\n");
            const choice = await ask("Large files", `${paths.join(", ")}: over 50 MB. Hosting services may reject them.`, [
              { label: "Ignore them", value: "ignore", primary: true },
              { label: "Commit anyway", value: "commit" },
              { label: "Cancel", value: "cancel" },
            ]);
            if (choice === "ignore") await gitIgnore(paths);
            else if (choice === "commit") allowLarge = true;
            else return;
            continue;
          }
          throw error;
        }
      }
    });
  };

  const publish = () =>
    act("Publishing…", async () => {
      const name = await prompt("Publish to GitHub", "Repository name", projectName.replace(/[^A-Za-z0-9._-]+/g, "-"), (v) =>
        /^[A-Za-z0-9._-]{1,100}$/.test(v) ? null : "Use letters, digits, dots, dashes or underscores.",
      );
      if (name === null) return;
      const visibility = await ask("Who can see it?", "Private repositories are visible only to you and people you invite.", [
        { label: "Private", value: "private", primary: true },
        { label: "Public", value: "public" },
      ]);
      if (visibility === null) return;
      try {
        const { url } = await gitPublishGithub(name, visibility === "private");
        return `Published: ${url}`;
      } catch (error) {
        if (isGitError(error, "ghNotInstalled")) {
          return { text: "Publishing needs GitHub CLI. Install it, or use Connect with a repository URL.", error: true };
        }
        throw error;
      }
    });

  const connect = () =>
    act("Connecting…", async () => {
      const url = await prompt("Connect to existing repository", "Repository URL", state?.remoteUrl ?? "", (v) =>
        /^(https:\/\/|ssh:\/\/|[^\s@/:]+@[^\s:/]+:)\S+$/.test(v) && !v.startsWith("-") ? null : "Paste an https:// or ssh address.",
      );
      if (url === null) return;
      await gitConnectRemote(url);
      return `Connected to ${url}`;
    });

  async function pullOnce(): Promise<Result | null> {
    if (!(await saveAll())) return null;
    const { pulled, conflicts } = await gitPull();
    await reloadFiles("all");
    if (conflicts.length) return { text: `Conflicts in ${plural(conflicts.length, "file")}. Pick a version for each, then commit.`, error: true };
    return { text: `Pulled ${plural(pulled, "commit")}` };
  }

  const pull = () => act("Pulling…", async () => (await pullOnce()) ?? undefined);
  const push = () => act("Pushing…", async () => `Pushed ${plural((await gitPush()).pushed, "commit")}`);
  const sync = () =>
    act("Syncing…", async () => {
      const pulled = await pullOnce();
      if (!pulled || pulled.error) return pulled ?? undefined;
      const { pushed } = await gitPush();
      return `${pulled.text}, pushed ${plural(pushed, "commit")}`;
    });

  const resolve = (path: string, take: "mine" | "theirs" | "edited") =>
    act("Resolving…", async () => {
      await gitResolve(path, take);
      await reloadFiles([path]);
    });

  const abortMerge = () =>
    act("Cancelling pull…", async () => {
      await gitAbortMerge();
      await reloadFiles("all");
      return "Pull cancelled.";
    });

  async function loadHistory(reset: boolean) {
    try {
      const page = await gitLog(reset ? 0 : commits.length, PAGE);
      setCommits((old) => (reset ? page : [...old, ...page]));
      setMore(page.length === PAGE);
    } catch (error) {
      setResult({ text: errorText(error), error: true });
    }
  }

  async function pickCommit(info: CommitInfo) {
    setCommit(info);
    setShown(null);
    setDiff(null);
    setSelected(null);
    try {
      setCommitFiles(await gitLogFiles(info.id));
    } catch (error) {
      setResult({ text: errorText(error), error: true });
    }
  }

  async function showDiff(path: string, against?: string) {
    setSelected(path);
    setShown(null);
    try {
      setDiff(await gitDiff(path, against));
    } catch (error) {
      setDiff(null);
      setResult({ text: errorText(error), error: true });
    }
  }

  async function viewOld(path: string) {
    if (!commit) return;
    try {
      setDiff(null);
      setSelected(path);
      setShown({ title: `${path} at “${commit.message}”`, text: await gitShowFile(commit.id, path) });
    } catch (error) {
      setResult({ text: errorText(error), error: true });
    }
  }

  const restoreFile = (path: string) =>
    commit &&
    act("Restoring…", async () => {
      if (!(await confirmRestoreFile(path))) return;
      await gitRestore(commit.id, path);
      await reloadFiles([path]);
      return `Restored ${path}. Commit to keep it.`;
    });

  const restoreAll = () =>
    commit &&
    act("Restoring…", async () => {
      const ok = await ask(
        "Restore whole project?",
        `All files will match “${commit.message}”. Later commits stay in history, so you can undo this.`,
        [
          { label: "Restore", value: "yes", primary: true },
          { label: "Cancel", value: "no" },
        ],
      );
      if (ok !== "yes" || !(await saveAll())) return;
      await gitRestore(commit.id);
      await reloadFiles("all");
      return "Project restored. Commit to keep it.";
    });

  // Ribbon and shortcut requests.
  useEffect(() => {
    if (!request) return;
    const run: Record<GitAction, () => unknown> = {
      init,
      commit: () => (message.trim() ? commitNow() : (setView("changes"), messageBox.current?.focus())),
      focus: () => (setView("changes"), setTimeout(() => messageBox.current?.focus())),
      changes: () => setView("changes"),
      history: () => setView("history"),
      publish,
      connect,
      push,
      pull,
      sync,
    };
    if (busy && !["focus", "changes", "history"].includes(request.action)) return;
    void run[request.action]();
    // Only new requests run; the handlers read current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.seq]);

  useEffect(() => {
    if (view === "history" && repo) void loadHistory(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, repo]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    try {
      listen<{ code: string; url: string }>("git-sign-in", (event) => {
        setSignIn(event.payload);
        void openUrl(event.payload.url).catch(() => undefined);
      }).then((off) => (dispose = off), () => undefined);
    } catch {
      // Not running inside Tauri.
    }
    return () => dispose?.();
  }, []);

  // A selected change that disappeared (committed or reverted) closes its diff.
  useEffect(() => {
    if (view === "changes" && selected && !state?.changes.some((c) => c.path === selected)) {
      setSelected(null);
      setDiff(null);
    }
  }, [state, view, selected]);

  const fileRow = (change: Change, onPick: () => void) => (
    <li key={change.path}>
      <button
        type="button"
        className={`git-file${selected === change.path ? " selected" : ""}`}
        title={change.oldPath ? `${change.oldPath} → ${change.path}` : change.path}
        onClick={onPick}
      >
        <span className={`git-letter ${change.status}`} aria-label={change.status}>
          {STATUS_LETTER[change.status]}
        </span>
        <span className="git-path">{change.path}</span>
      </button>
    </li>
  );

  return (
    <aside className="git-panel" aria-label="Version history">
      <header className="git-header">
        <strong>Git</strong>
        <div className="git-views" role="tablist">
          <button type="button" role="tab" aria-selected={view === "changes"} onClick={() => setView("changes")}>
            Changes
          </button>
          <button type="button" role="tab" aria-selected={view === "history"} disabled={!repo} onClick={() => setView("history")}>
            History
          </button>
        </div>
        <button type="button" className="git-close" aria-label="Close Git panel" onClick={onClose}>
          ×
        </button>
      </header>

      <p className="git-state" role="status">
        {stateLine(state)}
        {state?.branch ? <span className="git-branch"> on {state.branch}</span> : null}
      </p>
      {state && !state.installed ? (
        <button type="button" className="link" onClick={() => void openUrl(GIT_DOWNLOAD)}>
          Get Git for Windows
        </button>
      ) : null}
      {state?.repo === "parent" ? <p className="git-note">Part of the repository at {state.repoRoot}</p> : null}
      {state?.remoteUrl ? (
        <button type="button" className="link git-remote" onClick={() => void openUrl(webLink(state.remoteUrl!))}>
          {webLink(state.remoteUrl)}
        </button>
      ) : null}
      {state?.installed && state.repo === "none" ? (
        <button type="button" className="primary" disabled={!!busy || state.readOnly} onClick={() => void init()}>
          Start version history
        </button>
      ) : null}

      {busy ? (
        <p className="git-busy" role="status">
          {busy}
        </p>
      ) : null}
      {signIn ? (
        <p className="git-note">
          Enter code <strong>{signIn.code}</strong> on the GitHub page that opened.{" "}
          <button type="button" className="link" onClick={() => void openUrl(signIn.url)}>
            Open again
          </button>
        </p>
      ) : null}
      {result ? (
        <p className={`git-result${result.error ? " error" : ""}`} role={result.error ? "alert" : "status"}>
          {result.text}
          {result.pull ? (
            <button type="button" disabled={!canWrite} onClick={() => void pull()}>
              Pull
            </button>
          ) : null}
          {result.text.startsWith("Publishing needs GitHub CLI") ? (
            <button type="button" className="link" onClick={() => void openUrl(GH_DOWNLOAD)}>
              Get GitHub CLI
            </button>
          ) : null}
        </p>
      ) : null}

      {repo && view === "changes" ? (
        <>
          {merging ? (
            <div className="git-conflicts">
              {conflicts.map((change) => (
                <div key={change.path} className="git-conflict">
                  <span className="git-path">{change.path}</span>
                  <button type="button" disabled={!canWrite} onClick={() => void resolve(change.path, "mine")}>
                    Keep mine
                  </button>
                  <button type="button" disabled={!canWrite} onClick={() => void resolve(change.path, "theirs")}>
                    Keep theirs
                  </button>
                  <button type="button" disabled={!canWrite} onClick={() => void resolve(change.path, "edited")}>
                    Mark resolved
                  </button>
                </div>
              ))}
              <button type="button" disabled={!canWrite} onClick={() => void abortMerge()}>
                Cancel pull
              </button>
            </div>
          ) : null}
          <div className="git-commit">
            <textarea
              ref={messageBox}
              aria-label="Commit message"
              placeholder="What changed? (Ctrl+Enter to commit)"
              rows={2}
              value={message}
              disabled={state?.readOnly}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.ctrlKey) {
                  event.preventDefault();
                  void commitNow();
                }
              }}
            />
            <button
              type="button"
              className="primary"
              disabled={!canWrite || (!state?.changes.length && !merging) || conflicts.length > 0}
              onClick={() => void commitNow()}
            >
              Commit
            </button>
          </div>
          <ul className="git-files" aria-label="Changed files">
            {state?.changes.map((change) => fileRow(change, () => void showDiff(change.path)))}
          </ul>
        </>
      ) : null}

      {repo && view === "history" ? (
        <div className="git-history">
          <ul
            className="git-commits"
            aria-label="Commits"
            onScroll={(event) => {
              const box = event.currentTarget;
              if (more && box.scrollTop + box.clientHeight >= box.scrollHeight - 20) void loadHistory(false);
            }}
          >
            {commits.map((info) => (
              <li key={info.id}>
                <button type="button" className={`git-commit-row${commit?.id === info.id ? " selected" : ""}`} onClick={() => void pickCommit(info)}>
                  <span className="git-commit-message">{info.message}</span>
                  <span className="git-commit-meta">
                    {info.author} · {relativeDate(info.time * 1000)} · {plural(info.files, "file")}
                  </span>
                </button>
              </li>
            ))}
            {more && commits.length ? (
              <li>
                <button type="button" className="link" onClick={() => void loadHistory(false)}>
                  Load older commits
                </button>
              </li>
            ) : null}
          </ul>
          {commit ? (
            <div className="git-commit-detail">
              <button type="button" disabled={!canWrite} onClick={() => void restoreAll()}>
                Restore whole project to this point
              </button>
              <ul className="git-files" aria-label="Files in commit">
                {commitFiles.map((change) => (
                  <li key={change.path} className="git-commit-file">
                    <span className={`git-letter ${change.status}`}>{STATUS_LETTER[change.status]}</span>
                    <span className="git-path">{change.path}</span>
                    {change.status !== "deleted" ? (
                      <>
                        <button type="button" onClick={() => void viewOld(change.path)}>
                          View
                        </button>
                        <button type="button" onClick={() => void showDiff(change.path, commit.id)}>
                          Compare
                        </button>
                        <button type="button" disabled={!canWrite} onClick={() => void restoreFile(change.path)}>
                          Restore
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {shown ? (
        <div className="git-diff" aria-label={shown.title}>
          <p className="git-diff-title">{shown.title}</p>
          <pre>{shown.text}</pre>
        </div>
      ) : null}
      {diff && selected ? <DiffView path={selected} diff={diff} /> : null}
    </aside>
  );
}

function DiffView({ path, diff }: { path: string; diff: FileDiff }) {
  if (diff.binary) {
    return (
      <div className="git-diff">
        <p className="git-diff-title">
          {path}: binary file changed ({formatSize(diff.oldSize)} → {formatSize(diff.newSize)})
        </p>
      </div>
    );
  }
  const rows = parseDiff(diff.patch);
  return (
    <div className="git-diff" aria-label={`Changes in ${path}`}>
      <p className="git-diff-title">{path}</p>
      {rows.length === 0 ? <p className="git-note">No line changes.</p> : null}
      <table>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={`diff-${row.kind}`}>
              <td className="diff-num">{row.oldLine ?? ""}</td>
              <td className="diff-num">{row.newLine ?? ""}</td>
              <td className="diff-text">
                {row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}
                {row.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
