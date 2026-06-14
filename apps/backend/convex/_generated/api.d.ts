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
import type * as crons from "../crons.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as issues from "../issues.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_scrub from "../lib/scrub.js";
import type * as lib_slug from "../lib/slug.js";
import type * as maintenance from "../maintenance.js";
import type * as projects from "../projects.js";
import type * as releases from "../releases.js";
import type * as seed from "../seed.js";
import type * as sessions from "../sessions.js";
import type * as sourcemaps from "../sourcemaps.js";
import type * as transactions from "../transactions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  crons: typeof crons;
  events: typeof events;
  http: typeof http;
  ingest: typeof ingest;
  issues: typeof issues;
  "lib/auth": typeof lib_auth;
  "lib/scrub": typeof lib_scrub;
  "lib/slug": typeof lib_slug;
  maintenance: typeof maintenance;
  projects: typeof projects;
  releases: typeof releases;
  seed: typeof seed;
  sessions: typeof sessions;
  sourcemaps: typeof sourcemaps;
  transactions: typeof transactions;
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

export declare const components: {};
