import { defineApp } from 'convex/server';
import betterAuth from '@convex-dev/better-auth/convex.config';

// SPIKE: register the Better Auth component so its tables (user/session/account/
// organization/member/team/jwks) live in Convex, removing the Postgres dependency.
const app = defineApp();
app.use(betterAuth);
export default app;
