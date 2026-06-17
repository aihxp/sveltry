/**
 * Per-platform "install + initialize a Sentry SDK against this DSN" snippets.
 * Sveltry speaks the Sentry wire protocol, so the official `@sentry/*` (and
 * sentry-sdk / sentry-go / etc.) clients work unmodified: only the DSN changes.
 *
 * Shared by the new-project activation card, the first-run checklist, and the
 * per-platform docs so the install story stays consistent in one place.
 */

export interface SdkSnippet {
  /** The project platform key (matches `projects.platform`). */
  platform: string;
  /** Human label for the platform/SDK. */
  label: string;
  /** Package-manager install command. */
  install: string;
  /** Initialization code that wires the SDK to the DSN. */
  code: string;
  /** Syntax hint for highlighting / the code fence language. */
  language: string;
}

type SnippetTemplate = Omit<SdkSnippet, 'platform' | 'code'> & { code: (dsn: string) => string };

const TEMPLATES: Record<string, SnippetTemplate> = {
  javascript: {
    label: 'Browser JavaScript',
    install: 'npm install @sentry/browser',
    language: 'javascript',
    code: (dsn) => `import * as Sentry from '@sentry/browser';

Sentry.init({ dsn: '${dsn}' });`,
  },
  node: {
    label: 'Node.js',
    install: 'npm install @sentry/node',
    language: 'javascript',
    code: (dsn) => `import * as Sentry from '@sentry/node';

Sentry.init({ dsn: '${dsn}' });`,
  },
  python: {
    label: 'Python',
    install: 'pip install sentry-sdk',
    language: 'python',
    code: (dsn) => `import sentry_sdk

sentry_sdk.init(dsn="${dsn}")`,
  },
  go: {
    label: 'Go',
    install: 'go get github.com/getsentry/sentry-go',
    language: 'go',
    code: (dsn) => `import "github.com/getsentry/sentry-go"

sentry.Init(sentry.ClientOptions{
    Dsn: "${dsn}",
})`,
  },
  ruby: {
    label: 'Ruby',
    install: 'gem install sentry-ruby',
    language: 'ruby',
    code: (dsn) => `require 'sentry-ruby'

Sentry.init do |config|
  config.dsn = '${dsn}'
end`,
  },
  java: {
    label: 'Java',
    install: "implementation 'io.sentry:sentry:7.+' // build.gradle",
    language: 'java',
    code: (dsn) => `import io.sentry.Sentry;

Sentry.init(options -> {
  options.setDsn("${dsn}");
});`,
  },
  php: {
    label: 'PHP',
    install: 'composer require sentry/sentry',
    language: 'php',
    code: (dsn) => `\\Sentry\\init(['dsn' => '${dsn}']);`,
  },
  rust: {
    label: 'Rust',
    install: 'cargo add sentry',
    language: 'rust',
    code: (dsn) => `let _guard = sentry::init("${dsn}");`,
  },
};

const FALLBACK: SnippetTemplate = {
  label: 'Any Sentry SDK',
  install: '# install the official Sentry SDK for your language',
  language: 'text',
  code: (dsn) => `# Point any official Sentry SDK at this DSN:
${dsn}`,
};

/** The install + init snippet for a platform, filled in with the project's DSN. */
export function sdkSnippet(platform: string, dsn: string): SdkSnippet {
  const t = TEMPLATES[platform] ?? FALLBACK;
  return { platform, label: t.label, install: t.install, code: t.code(dsn), language: t.language };
}

/** All platforms that have a tailored snippet (for docs/menus), in display order. */
export const SNIPPET_PLATFORMS = Object.keys(TEMPLATES);
