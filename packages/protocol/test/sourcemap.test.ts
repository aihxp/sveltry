import { describe, expect, test } from 'bun:test';
import {
  applyOriginalPosition,
  basename,
  cleanSourceName,
  debugIdForRef,
  debugIdFromSourceMap,
  debugMetaImages,
  isInAppSource,
  matchSourcemap,
  normalizeRef,
  parseDebugId,
  parseSourceMappingURL,
} from '../src/sourcemap.js';

describe('debug ids', () => {
  test('parseDebugId reads the last debugId annotation', () => {
    expect(parseDebugId('a=1\n//# debugId=1a2b3c4d-0000-1111-2222-333344445555\n')).toBe(
      '1a2b3c4d-0000-1111-2222-333344445555',
    );
    expect(parseDebugId('//@ debugId=abcdef01')).toBe('abcdef01');
    expect(parseDebugId('no annotation here')).toBeNull();
  });

  test('debugIdFromSourceMap reads debugId or debug_id', () => {
    expect(debugIdFromSourceMap({ version: 3, debugId: 'dd' })).toBe('dd');
    expect(debugIdFromSourceMap({ version: 3, debug_id: 'ee' })).toBe('ee');
    expect(debugIdFromSourceMap({ version: 3 })).toBeNull();
    expect(debugIdFromSourceMap('not an object')).toBeNull();
  });

  test('debugMetaImages keeps only entries with a debug_id', () => {
    const imgs = debugMetaImages([
      { type: 'sourcemap', code_file: 'app:///main.js', debug_id: 'x' },
      { type: 'other' },
      null,
    ]);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.debug_id).toBe('x');
  });

  test('debugIdForRef matches a frame to its image by code_file then basename', () => {
    const images = [
      { type: 'sourcemap', code_file: 'app:///main.js', debug_id: 'main-id' },
      { type: 'sourcemap', code_file: 'https://cdn/x/vendor.js', debug_id: 'vendor-id' },
    ];
    expect(debugIdForRef('app:///main.js', images)).toBe('main-id');
    expect(debugIdForRef('https://host/main.js', images)).toBe('main-id');
    expect(debugIdForRef('https://cdn/x/vendor.js', images)).toBe('vendor-id');
    expect(debugIdForRef('unrelated.js', images)).toBeNull();
  });

  test('debugIdForRef falls back to the sole image without a code_file', () => {
    expect(debugIdForRef('whatever.js', [{ debug_id: 'only' }])).toBe('only');
    expect(debugIdForRef('whatever.js', [{ debug_id: 'a' }, { debug_id: 'b' }])).toBeNull();
  });
});

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
