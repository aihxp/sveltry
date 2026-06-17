declare global {
  /** The package version, injected at build time by vite.config (see `define`). */
  const __APP_VERSION__: string;
  namespace App {
    interface Error {
      errorId?: string;
    }
    // Auth is resolved client-side via the Convex Better Auth component, so there
    // is no server-side user/session on `locals` and no auth fields on page data.
    // interface Locals {}
    // interface PageData {}
    // interface Platform {}
  }
}

export {};
