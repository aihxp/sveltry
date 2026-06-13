-- Create the two logical databases Sveltry uses on a single Postgres server.
-- This script runs once, on first container start, before the backend connects.

-- The self-hosted Convex backend derives this name from its instance name
-- (`convex-self-hosted` -> dashes become underscores). It must exist before boot.
SELECT 'CREATE DATABASE convex_self_hosted'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'convex_self_hosted')\gexec

-- Better Auth's identity store (users, sessions, accounts, organizations, jwks).
SELECT 'CREATE DATABASE sveltry'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sveltry')\gexec
