import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Prune events past their per-project retention window, daily at 03:00 UTC.
crons.daily(
  'prune expired events',
  { hourUTC: 3, minuteUTC: 0 },
  internal.maintenance.sweepRetention,
);

// Transition `new` issues older than 7 days to `ongoing`, hourly.
crons.hourly('age new issues to ongoing', { minuteUTC: 15 }, internal.maintenance.sweepOngoing);

// Recompute hourly transaction-latency histograms for the trend view.
crons.hourly(
  'roll up transaction latency',
  { minuteUTC: 20 },
  internal.maintenance.rollupTransactions,
);

// Drop rolled-over ingest rate-limit windows so the table stays bounded, daily.
crons.daily(
  'prune rate-limit windows',
  { hourUTC: 3, minuteUTC: 30 },
  internal.maintenance.sweepRateLimitWindows,
);

// Probe HTTP uptime monitors that are due, every minute.
crons.interval('run uptime checks', { minutes: 1 }, internal.monitors.runUptimeChecks);

export default crons;
