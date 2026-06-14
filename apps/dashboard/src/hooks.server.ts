import type { HandleServerError } from '@sveltejs/kit';

// Auth is handled by the Convex Better Auth component + the /api/auth proxy route;
// route gating happens client-side, so the server hook only formats errors.
export const handleError: HandleServerError = ({ error, status, message }) => {
  const errorId = crypto.randomUUID();
  if (status !== 404) {
    console.error(`[sveltry] ${errorId}`, error);
  }
  return { message: status === 404 ? 'Not found' : (message ?? 'Internal error'), errorId };
};
