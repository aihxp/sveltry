import { describe, expect, test } from 'bun:test';
import {
  applyOriginalPosition,
  basename,
  cleanSourceName,
  isInAppSource,
  matchSourcemap,
  normalizeRef,
  parseSourceMappingURL,
} from '../src/sourcemap.js';

describe('reference normalization', () => {
  test('basename handles urls, posix and windows paths', () => {
    expect(basename('https://cdn.example.com/static/app.min.js?v=2')).toBe('app.min.js');
    expect(basename('C:\\dist\\app.min.js')).toBe('app.min.js');
    expect(basename('app.min.js')).toBe('app.min.js');
  });

  test('normalizeRef strips host-relative prefixes', () => {
    expect(normalizeRef('https://cdn.example.com/app.min.js')).toBe('app.min.js');
    expect(normalizeRef('~/app.min.js')).toBe('app.min.js');
    expect(normalizeRef('app:///app.min.js')).toBe('app.min.js');
    expect(normalizeRef('./build/app.min.js?123')).toBe('build/app.min.js');
  });
});

describe('sourceMappingURL parsing', () => {
  test('reads the last annotation', () => {
    expect(parseSourceMappingURL('console.log(1)\n//# sourceMappingURL=app.min.js.map')).toBe(
      'app.min.js.map',
    );
    expect(
      parseSourceMappingURL('a\n//@ sourceMappingURL=old.map\n//# sourceMappingURL=new.map'),
    ).toBe('new.map');
    expect(parseSourceMappingURL('no annotation here')).toBeNull();
  });
});

describe('matchSourcemap', () => {
  const maps = ['~/app.min.js.map', 'vendor.min.js.map'];
  test('matches a frame to its map across prefix styles', () => {
    expect(matchSourcemap('https://cdn.example.com/app.min.js', maps)).toBe('~/app.min.js.map');
    expect(matchSourcemap('app.min.js', maps)).toBe('~/app.min.js.map');
    expect(matchSourcemap('/static/vendor.min.js?v=9', maps)).toBe('vendor.min.js.map');
  });
  test('returns null when nothing matches', () => {
    expect(matchSourcemap('unknown.js', maps)).toBeNull();
  });
});

describe('source classification', () => {
  test('cleanSourceName strips bundler schemes', () => {
    expect(cleanSourceName('webpack:///./src/Button.tsx')).toBe('src/Button.tsx');
    expect(cleanSourceName('./src/foo.ts')).toBe('src/foo.ts');
  });
  test('isInAppSource excludes dependencies', () => {
    expect(isInAppSource('src/Button.tsx')).toBe(true);
    expect(isInAppSource('webpack:///./node_modules/react/index.js')).toBe(false);
  });
});

describe('applyOriginalPosition', () => {
  const frame = { filename: 'app.min.js', abs_path: 'app.min.js', lineno: 1, colno: 4210 };
  const source = 'function handleClick() {\n  throw new Error("boom");\n}\n';

  test('rewrites the frame and fills source context', () => {
    const out = applyOriginalPosition(
      frame,
      { source: 'webpack:///./src/Button.tsx', line: 2, column: 2, name: 'handleClick' },
      source,
    );
    expect(out.filename).toBe('src/Button.tsx');
    expect(out.abs_path).toBe('webpack:///./src/Button.tsx');
    expect(out.lineno).toBe(2);
    expect(out.colno).toBe(2);
    expect(out.function).toBe('handleClick');
    expect(out.context_line).toBe('  throw new Error("boom");');
    expect(out.pre_context).toEqual(['function handleClick() {']);
    expect(out.post_context).toEqual(['}', '']);
    expect(out.in_app).toBe(true);
    expect(out.sveltry_resolved).toBe(true);
  });

  test('returns the original frame when the position does not resolve', () => {
    const out = applyOriginalPosition(
      frame,
      { source: null, line: null, column: null, name: null },
      null,
    );
    expect(out).toBe(frame);
  });
});
