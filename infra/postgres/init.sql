-- Create the database the self-hosted Convex backend needs before it boots.
-- (Convex derives the name from its instance name: `convex-self-hosted` ->
-- `convex_self_hosted`.) Postgres here is Convex's own store; the app does not
-- use Postgres (auth runs on Convex via the Better Auth component).
SELECT 'CREATE DATABASE convex_self_hosted'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'convex_self_hosted')\gexec
