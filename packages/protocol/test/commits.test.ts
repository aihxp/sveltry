import { describe, expect, test } from 'bun:test';
import { commitTouchesFrame, normalizePath, suspectCommits } from '../src/commits.js';

describe('path matching', () => {
  test('normalizePath unifies separators and strips a leading ./', () => {
    expect(normalizePath('./src/app.ts')).toBe('src/app.ts');
    expect(normalizePath('src\\app.ts')).toBe('src/app.ts');
    expect(normalizePath('/src/app.ts')).toBe('src/app.ts');
  });

  test('commitTouchesFrame matches exact and path-boundary suffixes', () => {
    expect(commitTouchesFrame('src/app.ts', 'src/app.ts')).toBe(true);
    expect(commitTouchesFrame('packages/web/src/app.ts', 'src/app.ts')).toBe(true);
    expect(commitTouchesFrame('app.ts', 'src/app.ts')).toBe(true);
    expect(commitTouchesFrame('src/xapp.ts', 'app.ts')).toBe(false);
    expect(commitTouchesFrame('src/other.ts', 'src/app.ts')).toBe(false);
  });
});

describe('suspectCommits', () => {
  const commits = [
    { commitId: 'old', timestamp: 100, files: ['src/app.ts', 'README.md'] },
    { commitId: 'new', timestamp: 300, files: ['src/app.ts'] },
    { commitId: 'unrelated', timestamp: 400, files: ['docs/guide.md'] },
  ];

  test('returns commits touching a stack-trace file, most recent first', () => {
    const out = suspectCommits(['src/app.ts'], commits);
    expect(out.map((c) => c.commitId)).toEqual(['new', 'old']);
    expect(out[0]!.file).toBe('src/app.ts');
  });

  test('ignores commits that touch no stack-trace file', () => {
    const out = suspectCommits(['src/app.ts'], commits);
    expect(out.map((c) => c.commitId)).not.toContain('unrelated');
  });

  test('respects the limit and de-duplicates by commit id', () => {
    const dup = [
      { commitId: 'a', timestamp: 1, files: ['src/app.ts'] },
      { commitId: 'a', timestamp: 1, files: ['src/app.ts'] },
      { commitId: 'b', timestamp: 2, files: ['src/app.ts'] },
    ];
    expect(suspectCommits(['src/app.ts'], dup, 1).map((c) => c.commitId)).toEqual(['b']);
    expect(suspectCommits(['src/app.ts'], dup).map((c) => c.commitId)).toEqual(['b', 'a']);
  });

  test('returns nothing when there are no frame files or commits', () => {
    expect(suspectCommits([], commits)).toEqual([]);
    expect(suspectCommits(['src/app.ts'], [])).toEqual([]);
  });
});
