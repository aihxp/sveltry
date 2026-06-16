/** The inputs the `(app)` layout's client-side auth gate decides from. */
export interface AuthGateState {
  /** Auth state is still resolving (do not redirect yet). */
  authLoading: boolean;
  /** The caller is signed in. */
  authenticated: boolean;
  /** The active-org query is still resolving. */
  orgLoading: boolean;
  /** The resolved active org, or `null` when the user has none yet. */
  activeOrg: unknown;
  /** The current path, used to build the post-login return target. */
  path: string;
}

/**
 * The redirect the `(app)` layout should perform, or `null` to stay put. Pure, so
 * the gating decision is unit-testable without mounting the layout: an
 * unauthenticated caller goes to `/login` (preserving where they were headed), and
 * an authenticated caller with no active org goes to `/onboarding`. Anything still
 * loading stays put so the page never flickers a redirect before state resolves.
 */
export function authRedirect(s: AuthGateState): string | null {
  if (!s.authLoading && !s.authenticated) {
    return `/login?redirectTo=${encodeURIComponent(s.path)}`;
  }
  if (s.authenticated && !s.orgLoading && s.activeOrg === null) {
    return '/onboarding';
  }
  return null;
}
