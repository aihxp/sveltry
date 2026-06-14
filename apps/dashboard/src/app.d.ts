declare global {
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
