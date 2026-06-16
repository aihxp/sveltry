import { describe, expect, test } from 'bun:test';
import {
  commitTouchesFrame,
  normalizePath,
  parseResolvedShortIds,
  suspectCommits,
} from '../src/commits.js';

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

describe('parseResolvedShortIds', () => {
  test('extracts a prefixed short id after a fixes keyword', () => {
    expect(parseResolvedShortIds('Fix login crash (Fixes WEB-1A2B3C)')).toEqual(['1A2B3C']);
  });

  test('accepts close/resolve verbs and a lowercase prefix, case-insensitively', () => {
    expect(parseResolvedShortIds('closes WEB-9X8Y7Z')).toEqual(['9X8Y7Z']);
    expect(parseResolvedShortIds('Resolved: web-1a2b3c')).toEqual(['1A2B3C']);
  });

  test('takes the trailing token when the slug itself contains dashes', () => {
    expect(parseResolvedShortIds('Fixed DEMO-7305-ABCDEF')).toEqual(['ABCDEF']);
  });

  test('collects multiple, de-duplicated references', () => {
    expect(parseResolvedShortIds('fix WEB-1A2B3C and closes WEB-2C3D4E, fixes WEB-1A2B3C')).toEqual(
      ['1A2B3C', '2C3D4E'],
    );
  });

  test('requires the project-prefixed form; bare words are never a reference', () => {
    // "NAVBAR" is itself a valid 6-char Crockford token, but without a `<PROJECT>-`
    // prefix it is just an ordinary word, so "fix navbar" must resolve nothing.
    expect(parseResolvedShortIds('fix navbar; fixed header; resolve 1A2B3C')).toEqual([]);
    expect(parseResolvedShortIds('a commit with no references at all')).toEqual([]);
  });

  test('does not match keyword substrings (prefix/fixture)', () => {
    expect(parseResolvedShortIds('prefix WEB-1A2B3C; fixture WEB-2C3D4E')).toEqual([]);
  });
});
