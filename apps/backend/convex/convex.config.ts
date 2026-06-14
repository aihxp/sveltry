import { defineApp } from 'convex/server';
import betterAuth from '@convex-dev/better-auth/convex.config';

// Better Auth runs ON Convex (no Postgres). Identity only -- organizations are
// modeled natively in Convex (see organizations.ts), so the org plugin is unused.
const app = defineApp();
app.use(betterAuth);
export default app;
