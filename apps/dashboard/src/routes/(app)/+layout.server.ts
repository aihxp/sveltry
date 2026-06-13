import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    redirect(302, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }
  const activeOrganizationId =
    (locals.session as { activeOrganizationId?: string | null } | null)?.activeOrganizationId ??
    null;
  if (!activeOrganizationId) {
    redirect(302, '/onboarding');
  }
  return {
    user: { id: locals.user.id, name: locals.user.name, email: locals.user.email },
    activeOrganizationId,
  };
};
