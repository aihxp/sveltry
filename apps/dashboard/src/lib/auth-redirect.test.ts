import { describe, expect, test } from 'vitest';
import { authRedirect, type AuthGateState } from './auth-redirect';

const base: AuthGateState = {
  authLoading: false,
  authenticated: true,
  orgLoading: false,
  activeOrg: { id: 'org-a', name: 'Org A' },
  path: '/issues',
};

describe('authRedirect', () => {
  test('stays put while auth is still loading', () => {
    expect(authRedirect({ ...base, authLoading: true, authenticated: false })).toBeNull();
  });

  test('redirects an unauthenticated caller to /login, preserving the return path', () => {
    expect(authRedirect({ ...base, authenticated: false, path: '/projects/web' })).toBe(
      '/login?redirectTo=%2Fprojects%2Fweb',
    );
  });

  test('stays put while the active-org query is still loading', () => {
    expect(authRedirect({ ...base, orgLoading: true, activeOrg: null })).toBeNull();
  });

  test('redirects an authenticated caller with no active org to /onboarding', () => {
    expect(authRedirect({ ...base, activeOrg: null })).toBe('/onboarding');
  });

  test('stays put for an authenticated caller with an active org', () => {
    expect(authRedirect(base)).toBeNull();
  });
});
