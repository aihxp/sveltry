/**
 * Suspect-commit matching. Given the file paths in an issue's stack trace (ideally
 * the in-app, source-map-resolved frames) and a release's commits (each with the
 * files it changed), pick the commits most likely to have introduced the issue:
 * those that touched a file in the stack trace, most recent first. Pure and
 * unit-tested so the backend can share it.
 */

export interface CommitInput {
  commitId: string;
  timestamp: number;
  files: readonly string[];
}

export interface SuspectCommit {
  commitId: string;
  /** The stack-trace file the commit touched (the reason it is a suspect). */
  file: string;
}

/** Normalize a path for comparison: unify separators, drop a leading `./` or `/`. */
export function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '');
}

/** Whether a commit's changed file refers to the same file as a stack-trace frame. */
export function commitTouchesFrame(commitFile: string, frameFile: string): boolean {
  const c = normalizePath(commitFile);
  const f = normalizePath(frameFile);
  if (!c || !f) return false;
  if (c === f) return true;
  // One path is often repo-relative and the other longer/shorter; match when one is
  // a suffix of the other on a path boundary (so `app.ts` does not match `xapp.ts`).
  return c.endsWith('/' + f) || f.endsWith('/' + c);
}

/**
 * Rank a release's commits by how likely each introduced the issue. A commit is a
 * suspect if it changed a file that appears in `frameFiles`; suspects are returned
 * most recent first, de-duplicated, capped at `limit`.
 */
export function suspectCommits(
  frameFiles: readonly string[],
  commits: readonly CommitInput[],
  limit = 3,
): SuspectCommit[] {
  const files = [...new Set(frameFiles.map(normalizePath).filter(Boolean))];
  if (files.length === 0 || commits.length === 0) return [];

  const matched: { commit: CommitInput; file: string }[] = [];
  for (const commit of commits) {
    let hit: string | undefined;
    for (const cf of commit.files) {
      hit = files.find((f) => commitTouchesFrame(cf, f));
      if (hit) break;
    }
    if (hit) matched.push({ commit, file: hit });
  }
  matched.sort((a, b) => b.commit.timestamp - a.commit.timestamp);

  const seen = new Set<string>();
  const out: SuspectCommit[] = [];
  for (const m of matched) {
    if (seen.has(m.commit.commitId)) continue;
    seen.add(m.commit.commitId);
    out.push({ commitId: m.commit.commitId, file: m.file });
    if (out.length >= limit) break;
  }
  return out;
}
