import type { Handle, HandleServerError } from '@sveltejs/kit';
import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '$lib/auth';

export const handle: Handle = async ({ event, resolve }) => {
  // svelteKitHandler intercepts /api/auth/* but does NOT populate locals, so we
  // resolve the session ourselves for SSR-protected loads.
  const session = await auth.api.getSession({ headers: event.request.headers });
  event.locals.user = session?.user ?? null;
  event.locals.session = session?.session ?? null;

  return svelteKitHandler({ event, resolve, auth, building });
};

export const handleError: HandleServerError = ({ error, status, message }) => {
  const errorId = crypto.randomUUID();
  if (status !== 404) {
    console.error(`[sveltry] ${errorId}`, error);
  }
  return { message: status === 404 ? 'Not found' : (message ?? 'Internal error'), errorId };
};
