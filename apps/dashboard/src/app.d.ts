import type { auth } from '$lib/auth';

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

declare global {
  namespace App {
    interface Error {
      errorId?: string;
    }
    interface Locals {
      user: NonNullable<Session>['user'] | null;
      session: NonNullable<Session>['session'] | null;
    }
    interface PageData {
      user?: NonNullable<Session>['user'] | null;
      activeOrganizationId?: string | null;
    }
    // interface Platform {}
  }
}

export {};
