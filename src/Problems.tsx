import type { Problem } from "./compile";

type Props = {
  problems: Problem[];
  onJump: (file: string, line: number) => void;
};

/** Compile errors and warnings; rows with a file and line jump there (spec 003 US3). */
export function Problems({ problems, onJump }: Props) {
  if (!problems.length) return <p className="problems-empty">No problems</p>;
  return (
    <ul className="problems" aria-label="Problems">
      {problems.map((problem, index) => {
        const where = problem.file ? `${problem.file}${problem.line ? `:${problem.line}` : ""}` : null;
        const body = (
          <>
            <span className={`problem-icon ${problem.severity}`} aria-label={problem.severity === "error" ? "Error" : "Warning"}>
              {problem.severity === "error" ? "✕" : "!"}
            </span>
            {where ? <span className="problem-where">{where}</span> : null}
            <span className="problem-message">{problem.message}</span>
          </>
        );
        return (
          <li key={index}>
            {problem.file && problem.line ? (
              <button type="button" className="problem-row" onClick={() => onJump(problem.file!, problem.line!)}>
                {body}
              </button>
            ) : (
              <div className="problem-row">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
