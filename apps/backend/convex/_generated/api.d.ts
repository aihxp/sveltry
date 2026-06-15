/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alerts from "../alerts.js";
import type * as betterauth from "../betterauth.js";
import type * as commits from "../commits.js";
import type * as crons from "../crons.js";
import type * as dashboards from "../dashboards.js";
import type * as discover from "../discover.js";
import type * as email from "../email.js";
import type * as events from "../events.js";
import type * as feedback from "../feedback.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as integrations from "../integrations.js";
import type * as invitations from "../invitations.js";
import type * as issues from "../issues.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_net from "../lib/net.js";
import type * as lib_scrub from "../lib/scrub.js";
import type * as lib_slug from "../lib/slug.js";
import type * as maintenance from "../maintenance.js";
import type * as metricAlerts from "../metricAlerts.js";
import type * as monitors from "../monitors.js";
import type * as organizations from "../organizations.js";
import type * as profiles from "../profiles.js";
import type * as projects from "../projects.js";
import type * as releases from "../releases.js";
import type * as replays from "../replays.js";
import type * as roles from "../roles.js";
import type * as savedViews from "../savedViews.js";
import type * as seed from "../seed.js";
import type * as sessions from "../sessions.js";
import type * as sourcemaps from "../sourcemaps.js";
import type * as storage from "../storage.js";
import type * as teams from "../teams.js";
import type * as transactions from "../transactions.js";
import type * as usage from "../usage.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  betterauth: typeof betterauth;
  commits: typeof commits;
  crons: typeof crons;
  dashboards: typeof dashboards;
  discover: typeof discover;
  email: typeof email;
  events: typeof events;
  feedback: typeof feedback;
  http: typeof http;
  ingest: typeof ingest;
  integrations: typeof integrations;
  invitations: typeof invitations;
  issues: typeof issues;
  "lib/auth": typeof lib_auth;
  "lib/net": typeof lib_net;
  "lib/scrub": typeof lib_scrub;
  "lib/slug": typeof lib_slug;
  maintenance: typeof maintenance;
  metricAlerts: typeof metricAlerts;
  monitors: typeof monitors;
  organizations: typeof organizations;
  profiles: typeof profiles;
  projects: typeof projects;
  releases: typeof releases;
  replays: typeof replays;
  roles: typeof roles;
  savedViews: typeof savedViews;
  seed: typeof seed;
  sessions: typeof sessions;
  sourcemaps: typeof sourcemaps;
  storage: typeof storage;
  teams: typeof teams;
  transactions: typeof transactions;
  usage: typeof usage;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
