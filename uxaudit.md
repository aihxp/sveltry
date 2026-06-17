# Sveltry - UX Audit

> Read-only UX audit. Date: 2026-06-17. This report is self-contained: every
> finding cites a concrete location and how to verify the fix. No source, design,
> or config files were changed; the only file created is this one.

## Snapshot

- **Product**: Sveltry, an open-source, self-hosted, Sentry-wire-compatible error
  tracker (errors, performance, replays, release health, cron/uptime monitors).
- **State**: branch `main`, commit `ed03cad` (release v0.10.0).
- **Surface / type**: a web app (SvelteKit 2 dashboard) + a public marketing
  landing + a developer-experience surface (the DSN/SDK setup flow and the
  `@aihxp/sveltry-sdk`). 30 route pages, 31 components.
- **Frameworks / design system**: SvelteKit 2, Svelte 5 (runes), Tailwind CSS v4,
  shadcn-svelte primitives, lucide icons, Convex reactive data (`convex-svelte`),
  Better Auth.
- **Primary actor**: a developer / SRE who self-hosts Sveltry, wires an SDK into
  their app, and then triages incoming errors. Secondary: an org admin managing
  projects, members, alerts, and tokens. **Assumed context of use**: primarily a
  desktop browser during development and incident response; mobile is occasional.
- **Evident maturity**: a production-aimed, pre-1.0 product that is genuinely
  usable end to end (recently hardened across a security re-audit and a six-part
  launch-readiness pass). Calibrated to "production product approaching 1.0," not
  a prototype.
- **Coverage**: the running dashboard was walked in a local preview (signup ->
  onboarding -> create project -> first event; the Overview; Issues; project
  setup; the Help menu; the landing page; and a mobile-width pass). The auth,
  project-settings, alert, and team flows were read in source. Sampled, not
  exhaustive: not every one of the 30 routes was walked at runtime.
- **Exclusions**: vendored shadcn-svelte primitives under `ui/` (audited for use,
  not re-reviewed as a library), generated Convex API, the demo seed data.

## Overall score

**80 / 100 - Grade B (solid, minor issues)**

Sveltry delivers a genuinely strong developer onboarding, the path from a fresh
org to a first tracked error is guided, platform-aware, and confirmed live, on
top of a consistent, polished design system with real loading and empty states.
The experience is held out of the A band by two cross-cutting gaps: the primary
navigation is unreachable on narrow viewports (no mobile menu replaces the hidden
sidebar), and most mutations, including irreversible deletes of webhooks, API
tokens, and teams, fire on a single click with neither a confirmation nor any
success feedback. Calibration: graded as a near-1.0 developer tool used mostly on
desktop, so the mobile-nav gap is High rather than Critical, and runtime-only
checks (contrast, focus order, Core Web Vitals) are deferred as Suspected.

| Dimension | Score | Grade | Weight | Verdict |
|---|---|---|---|---|
| Usability and Heuristics | 73 | C | 13% | Strong status visibility and a gold-standard delete-with-typed-confirm on projects, undermined by one-click destructive deletes everywhere else and no success feedback. |
| Accessibility and Inclusive Design | 76 | C | 13% | Focus rings, icon labels, and zoom support are right; placeholder-only search inputs, no reduced-motion guard, and unverified runtime contrast pull it down. |
| User Journeys and Flows | 78 | C | 11% | The activation journey is excellent; the recurring triage journey is clean; both are blocked on mobile by missing navigation. |
| Process and Workflow Efficiency | 82 | B | 11% | Lean, low-step flows with smart defaults; the only waste is the absence of guard rails, not excess steps. |
| Interaction and Visual Design | 85 | B | 9% | Consistent shadcn-svelte system, real component states, polished activation cards and landing. |
| Information Architecture and Navigation | 80 | B | 8% | Clear sidebar with active-state and good labels on desktop; the same nav is absent on mobile. |
| Content and UX Writing | 80 | B | 8% | Action-named buttons and teaching empty states; a few raw `error.toString()` strings leak to users. |
| Onboarding, Conversion and Engagement | 88 | B | 8% | A guided checklist, per-platform setup, and a live first-event confirmation, best-in-class for the category. |
| Forms and Input | 80 | B | 7% | Exemplary auth forms (labels, autocomplete, input types); search inputs are placeholder-only. |
| Performance and Responsiveness | 78 | C | 6% | Reactive data, skeletons, and zoom-friendly viewport; layout-shift and CWV numbers unverified. |
| Trust, Ethics and Transparency | 90 | A | 6% | Self-hosted, first-party, zero deceptive patterns, real org/repo/license; only raw errors dent credibility. |
| **Weighted overall** | **80** | **B** | 100% | A polished, well-onboarded developer product with two fixable cross-cutting gaps. |

Re-weighting: default weights, with no change. Onboarding and process matter a lot
for a self-hosted dev tool, but the default already weights them adequately; the
defaults are kept so this score is comparable to a re-run.

## What to fix first

1. `[USE-001]` Destructive deletes fire on one click with no confirm and no undo - High, M - a misclick permanently destroys webhooks (incl. their one-time secret), API tokens, teams, and alert rules. [RESOLVED - UX-Slice 2]
2. `[JRN-001]` No navigation on mobile / narrow viewports - High, M - the sidebar is hidden below `md` with no menu to replace it, so a phone user cannot reach most of the app. [RESOLVED - UX-Slice 3]
3. `[USE-002]` No success feedback after any mutation - Medium, M - saves, creates, and deletes succeed silently, so the user cannot tell an action worked. [RESOLVED - UX-Slice 1]
4. `[CNT-001]` Raw `error.toString()` strings shown to users on load failures - Medium, S - list views render technical error text instead of a human, recoverable message. [RESOLVED - UX-Slice 4]
5. `[FRM-001]` Search inputs are placeholder-only (no accessible label) - Medium, S - the label vanishes on input and is an unreliable accessible name for screen readers.

## Strengths (preserve these)

- **Best-in-class activation funnel.** Creating a project shows a platform-tailored
  install + init (e.g. `pip install sentry-sdk` for Python) as three numbered,
  copyable steps, and the card then confirms the integration **live** ("Listening
  for your first event..." -> "First event received") via the reactive
  `projects.firstEventForProject` query (`apps/dashboard/src/routes/(app)/projects/new/+page.svelte`).
  Verified at runtime by sending a real event and watching the card flip. Do not
  flatten this into a static "here's your DSN" screen.
- **A guided first-run checklist** on the Overview (`SetupChecklist.svelte`) that
  ticks off live and self-hides when complete, and a fresh-install Overview that
  nudges "Create your first project" instead of a false "all clear."
- **Auth forms done right** (`login/+page.svelte`, `signup/+page.svelte`):
  persistent `<Label for>` tied by `id`, `autocomplete="email"` /
  `current-password` / (signup) `new-password`, and correct `type`s. Password
  managers and autofill work.
- **Real loading and empty states**: 15 routes use `Skeleton` loaders, and 15 use
  the `EmptyState` component, which renders a title, an explanatory description,
  and a call-to-action slot (`EmptyState.svelte`) rather than a bare "No data."
- **The destructive-action pattern already exists and is excellent** where it is
  used: project delete and transfer require typing the project name to confirm
  (`projects/[slug]/+page.svelte:265,298`). The fix for USE-001 is to apply this
  existing pattern more widely, not invent one.
- **Accessibility fundamentals**: focus is handled via the shadcn
  `focus-visible:outline-none focus-visible:ring` pattern (no bare `outline:none`
  on interactive controls), icon-only buttons carry `aria-label` (ThemeToggle,
  the trash buttons, Help, the checklist dismiss), and the viewport allows zoom
  (`app.html`: `width=device-width, initial-scale=1`, no `user-scalable=no`).
- **In-app Help** (`(app)/+layout.svelte`): a header `?` dropdown linking to docs,
  quickstart, SDK compatibility, self-hosting, and "report an issue," with the
  running version shown, openable with the `?` key.
- **Trust**: self-hosted and first-party (no third-party trackers or cookie-consent
  dark patterns), a real repo/org and Apache-2.0 license, and zero deceptive
  patterns (no fake urgency, no confirmshaming, no asymmetric cancel).

## Systemic patterns (root causes)

- **No global feedback layer for mutations.** Members: `USE-001`, `USE-002`. There
  is no toast/snackbar system and no shared confirm dialog. As a result, write
  actions neither confirm intent beforehand (destructive ones) nor acknowledge
  success afterward. Root fix: add one toast primitive and one reusable confirm
  dialog (the typed-name confirm already exists for projects), then route
  mutations through them, destructive ones get a confirm, all get a success
  toast.
- **Technical strings surface where human copy belongs.** Members: `CNT-001`. List
  views render `query.error.toString()` directly. Root fix: a small
  `friendlyError(err)` helper + a shared `<LoadError onretry>` block, used at every
  `query.error` site, that shows a plain message and a Retry action.
- **The app shell is desktop-only.** Members: `JRN-001`, `IA-001`. The sidebar is
  `hidden md:flex` with no mobile equivalent. Root fix: one mobile nav (a
  hamburger that opens the existing `nav` list in a drawer/sheet) reused by both
  findings.

## Findings

### [USE-001] Destructive deletes fire on a single click with no confirmation and no undo [RESOLVED - UX-Slice 2]
- Resolution: Added a reusable, accessible confirm dialog (`apps/dashboard/src/lib/confirm.svelte.ts` + `apps/dashboard/src/lib/components/ConfirmDialog.svelte`, mounted once in `(app)/+layout.svelte`): `role="alertdialog"`, `aria-modal`, labelled/described by its heading and body, focus moved in on open and restored on close, Tab trapped, Escape and backdrop cancel. Gated all 13 one-click delete/revoke handlers behind `await confirm(...)` (webhooks, API tokens, invites, team members, teams, alert/metric/usage alerts, uptime monitors, saved views, comments, dashboards, widgets, issue-tracker integration, repository link), each emitting a "Deleted" toast on success and an error toast on failure. The two highest-stakes actions (delete team, revoke API token) require typing the team/token name to arm the confirm, reusing the typed-name pattern already used for project delete/transfer. Verified at runtime: the dialog opens accessibly, the confirm stays disabled until the exact name is typed, Escape cancels without deleting, and confirming deletes and shows the toast.
- Severity: High | Confidence: Confirmed | Effort: M | Dimension: Usability and Heuristics
- Location: `apps/dashboard/src/lib/components/project/WebhooksCard.svelte:61` (removeWebhook), `apps/dashboard/src/routes/(app)/settings/+page.svelte:121` (revokeToken) and `:87` (revokeInvite), `apps/dashboard/src/routes/(app)/teams/+page.svelte:63,66` (removeMember, deleteTeam), `AlertRulesCard.svelte:45`, `MetricAlertsCard.svelte:52`, `UsageAlertsCard.svelte:38`, `monitors/+page.svelte:55` (deleteUptime), `issues/+page.svelte:81` (deleteView), `issues/[id]/+page.svelte:164` (deleteComment), `dashboards/+page.svelte:35` and `dashboards/[id]/+page.svelte:102` (remove, removeWidget), `IntegrationCard.svelte:71`, `projects/[slug]/+page.svelte:232` (removeRepo).
- Evidence: 14 of the 16 delete/remove/revoke handlers call the Convex mutation immediately from an icon button's `onclick`, with no confirmation step and no undo. Only `deleteProject` and `transferProject` (`projects/[slug]/+page.svelte:265,298`) require a typed-name confirmation. Deleting a webhook also destroys its HMAC signing secret (shown only once at creation); revoking an API token silently breaks every integration using it; deleting a team removes its membership.
- Impact: A single misclick on a small trash icon permanently and irreversibly destroys configuration that is costly or impossible to recreate (a webhook secret, a token's integrations, a team). This is Nielsen's "user control and freedom" and "error prevention" failing on exactly the actions that most need a guard.
- Recommendation: Add one reusable confirm dialog and gate the costly/irreversible deletes (webhooks, tokens, teams, integrations, alert rules, monitors) behind it; for the lighter ones (a saved view, a comment), a confirm or, better, an undo toast is enough. Reuse the typed-name pattern already in `projects/[slug]` for the highest-stakes ones.
- Verify the fix: Click each delete control and confirm a confirmation appears before the mutation runs; for webhooks/tokens, confirm the action cannot complete without an explicit second step; add a component test that the mutation is not called until confirmed.
- Related: systemic "No global feedback layer for mutations."

### [JRN-001] Primary navigation is unreachable on mobile / narrow viewports [RESOLVED - UX-Slice 3]
- Resolution: Added a hamburger button to the mobile header (`(app)/+layout.svelte`) that opens the full nav in a left slide-over drawer (`role="dialog"`, `aria-modal`, `aria-label="Navigation"`). The drawer reuses the exact same `nav` list as the desktop sidebar via a shared `{#snippet navList()}`, so they cannot drift; the active link carries `aria-current="page"`. Focus moves into the drawer on open and Tab is trapped inside; it closes on Escape, backdrop click, and (via `afterNavigate`) on any navigation. Verified at 375px: sidebar hidden + hamburger shown, drawer lists all 14 links, Escape/backdrop/nav-link all close it with no lingering overlay; at 1280px the sidebar shows and the hamburger is hidden. Resolves the systemic "app shell is desktop-only" pattern (and its `IA-001` member).
- Severity: High | Confidence: Confirmed | Effort: M | Dimension: User Journeys and Flows
- Location: `apps/dashboard/src/routes/(app)/+layout.svelte:102` (`<aside class="hidden ... md:flex">`), `:131` (the `md:hidden` header shows only the Logo); zero `Menu`/hamburger references in the file.
- Evidence: The sidebar that holds all 14 primary nav links (Overview, Issues, Performance, Discover, Dashboards, Releases, Monitors, Replays, Profiles, Feedback, Stats, Projects, Teams, Settings) is `hidden md:flex`, so it disappears below 768px. The mobile header renders only the logo, the Help dropdown, the theme toggle, and the user-avatar menu, no navigation. Confirmed at runtime: a 375px screenshot of `/dashboard` shows the page content but no way to navigate; the only escapes are "View all issues," Settings/Sign out in the avatar menu, and the Help links.
- Impact: On a phone or a narrow window, an authenticated user is stranded on whatever page they land on and cannot reach most of the product. For an error tracker, on-call triage from a phone is a real use case, this blocks it.
- Recommendation: Add a hamburger button in the mobile header that opens the existing `nav` array in a slide-over/sheet (or a `<details>`-based menu, consistent with the current dropdown pattern). Reuse the same `nav` list so it cannot drift from the desktop sidebar.
- Verify the fix: At 375px width, open the menu and navigate to Issues, Performance, and Projects; confirm the active-state indicator works and the menu closes on selection. Run an axe/keyboard pass on the menu.
- Related: `IA-001`; systemic "The app shell is desktop-only."

### [USE-002] No success feedback after a save, create, or delete [RESOLVED - UX-Slice 1]
- Resolution: Added an app-wide toast store (`apps/dashboard/src/lib/toast.svelte.ts`) and a `<Toaster />` viewport mounted once in `(app)/+layout.svelte` (an `aria-live="polite"` region that announces status messages, WCAG 4.1.3). Wired success/error toasts into the mutation sites: project settings/filters/repo/origins/team-assignment, webhook create + enable/disable, API-token create, member-role change, and team create + add-member. Destructive deletes get their "Deleted" toast in UX-Slice 2 (where the confirm dialog lands).
- Severity: Medium | Confidence: Confirmed | Effort: M | Dimension: Usability and Heuristics
- Location: no toast/snackbar system exists (grep for toast/Sonner/Snackbar across the dashboard returns nothing); e.g. `projects/[slug]/+page.svelte` `saveSettings`/`saveFilters`/`saveRepo` set `saving=false` with no success signal; `settings/+page.svelte` invite/token creation; the alert/webhook/monitor create handlers.
- Evidence: After a successful mutation, the only feedback is the button leaving its "Saving..." state (and sometimes a form clearing). There is no explicit "Saved" / "Project updated" / "Webhook deleted" confirmation anywhere.
- Impact: Visibility of system status (Nielsen #1): the user cannot distinguish "it saved" from "nothing happened," and for fire-and-forget actions like saving project settings, there is no positive acknowledgment at all, which erodes confidence and invites duplicate submits.
- Recommendation: Add a single toast primitive and emit a short success toast on each mutation's resolution (and reuse it for error toasts). Keep inline field errors for validation; use the toast for action-level outcomes.
- Verify the fix: Save project settings and confirm a "Saved" toast appears within ~400ms (the Doherty threshold); delete an item and confirm a "Deleted" (ideally with Undo) toast.
- Related: systemic "No global feedback layer for mutations."

### [CNT-001] Raw `error.toString()` is shown to users on load failures [RESOLVED - UX-Slice 4]
- Resolution: Added a shared `<LoadError message error onretry />` block (`apps/dashboard/src/lib/components/LoadError.svelte`) that shows a plain, per-view message and a Retry action, and logs the raw error to the console for developers instead of rendering it. Replaced all 11 `{x.error.toString()}` sites (monitors, releases, discover, feedback, profiles, replays, performance, performance/issues, performance/spans, dashboard, issues) with it; zero `error.toString()` remain in the routes. Verified the happy path still renders and the same primitives render correctly (see the error-boundary screenshot).
- Severity: Medium | Confidence: Confirmed | Effort: S | Dimension: Content and UX Writing
- Location: `monitors/+page.svelte:149` (`{monitors.error.toString()}`), `releases/+page.svelte:48` (`{health.error.toString()}`), `discover/+page.svelte:189` (`{result.error.toString()}`).
- Evidence: When a reactive query errors, these views render the raw error object stringified directly into the page ("Failed to load: <technical string>"). A Convex/transport error message is developer-facing text, not a user message, and offers no recovery action.
- Impact: Violates "help users recognize, diagnose, and recover from errors", the user sees a technical string with no plain-language explanation and no Retry, and (per Stanford credibility guidance) leaked technical errors dent trust out of proportion to their frequency.
- Recommendation: Replace the inline `error.toString()` with a shared load-error block ("Couldn't load <thing>. Retry") that maps the error to a friendly message and offers a Retry button; log the raw error to the console for developers.
- Verify the fix: Force a query error (e.g. disconnect the backend) and confirm the view shows a plain message + Retry, with no raw object string in the DOM.
- Related: systemic "Technical strings surface where human copy belongs."

### [FRM-001] Search inputs are placeholder-only (no accessible label)
- Severity: Medium | Confidence: Confirmed | Effort: S | Dimension: Forms and Input
- Location: `issues/+page.svelte:99` (`<Input ... placeholder="Search issues by title…" />`), `issues/[id]/+page.svelte:434` (the merge-search input).
- Evidence: These inputs carry a `placeholder` but no visible `<Label>` and no `aria-label`. Placeholder-as-label disappears the moment the user types, and a placeholder is not a reliable accessible name for assistive tech (Baymard; WCAG label-in-name).
- Impact: A screen-reader user may reach an unlabeled text field, and any user who starts typing loses the hint of what the field searches. The rest of the app's forms use proper labels, so this is an inconsistency as well as an a11y gap.
- Recommendation: Add `aria-label="Search issues"` (and a visible label or an icon+label where space allows) to the search inputs. A leading search icon is already present; pair it with an accessible name.
- Verify the fix: Inspect the input's accessible name in the a11y tree (it should be "Search issues," not empty); confirm with a screen reader that the field is announced.
- Related: none.

### [ACC-001] No `prefers-reduced-motion` handling for the live/pulse animations
- Severity: Low | Confidence: Confirmed | Effort: S | Dimension: Accessibility and Inclusive Design
- Location: 6 `animate-pulse` usages (e.g. the "live" indicator dot on the Overview/landing, skeleton loaders); no `motion-reduce:` utility or `prefers-reduced-motion` media query anywhere in `apps/dashboard/src`.
- Evidence: Animations are unconditional. `animate-pulse` is a gentle opacity loop (not a vestibular-trigger like parallax or large transl/scale), so the risk is mild, but inclusive-design guidance is to honor the OS reduced-motion setting.
- Impact: Users who set "reduce motion" still see continuous pulsing, a minor but real inclusive-design gap.
- Recommendation: Gate non-essential animation behind Tailwind's `motion-reduce:` variant (e.g. `motion-reduce:animate-none`) or a global `@media (prefers-reduced-motion: reduce)` rule that disables `animate-pulse`/`animate-spin`.
- Verify the fix: Enable "reduce motion" in the OS and confirm the live dot and spinners stop animating.
- Related: none.

### [USE-003] Native `<details>` dropdowns do not close on outside-click or Escape
- Severity: Low | Confidence: Confirmed | Effort: S | Dimension: Usability and Heuristics
- Location: `(app)/+layout.svelte` (the Help `<details>` and the user-avatar `<details>`).
- Evidence: The header menus are native `<details>/<summary>`. A native `<details>` only toggles via its summary, it does not close when the user clicks elsewhere or presses Escape, which are the conventions users expect of a dropdown/menu.
- Impact: Minor friction: an opened menu lingers until the user clicks the summary again; two menus can be open at once. It is keyboard-operable (a strength), just not dismissible the expected way.
- Recommendation: Add a lightweight outside-click + Escape handler that sets `details.open = false` (or adopt the shadcn-svelte dropdown-menu primitive for these two menus).
- Verify the fix: Open the Help menu, click elsewhere, and confirm it closes; press Escape and confirm it closes.
- Related: none.

### [USE-004] No application-level error boundary (`+error.svelte`) [RESOLVED - UX-Slice 4]
- Resolution: Added a root `apps/dashboard/src/routes/+error.svelte` (branded page with the status, a friendly message, "Back to home", and "Report an issue") and an `(app)/+error.svelte` (renders inside the app shell with "Back to overview" + report link). Verified at runtime: visiting an unknown route shows the branded 404 page with both recovery actions instead of SvelteKit's default.
- Severity: Medium | Confidence: Confirmed | Effort: S | Dimension: Usability and Heuristics
- Location: no `+error.svelte` exists under `apps/dashboard/src/routes` (find returns nothing).
- Evidence: There is no SvelteKit error page, so an unhandled route error (a thrown load, a render error) falls through to SvelteKit's default unstyled error page with no branding and no recovery action. (A dev-only SSR hiccup was observed earlier on a hard reload; in production the same class of error would land here.)
- Impact: A user who hits a route error sees a bare "Internal Error" page with no way forward, no link home, no retry, no support path.
- Recommendation: Add a root `+error.svelte` (and optionally a `(app)/+error.svelte`) that shows a friendly message, the status, a "Back to overview" link, and a "report an issue" link (reusing the Help menu's GitHub link).
- Verify the fix: Trigger a route error and confirm the branded error page renders with a working recovery link.
- Related: `CNT-001`.

### [PRF-001] Core Web Vitals and layout-shift not verified (runtime check needed)
- Severity: Low | Confidence: Suspected | Effort: S | Dimension: Performance and Responsiveness
- Location: whole dashboard; e.g. images/media sizing, the live-updating lists.
- Evidence: From static code the perceived-performance signals are good (reactive Convex data, 15 routes with skeleton loaders, a sane viewport). But real LCP/INP/CLS, runtime contrast, and focus order cannot be read from source; the app has no `<img>` media to mis-size (a plus), yet late-loading reactive lists could shift layout.
- Impact: Cannot assign a numeric performance verdict without measurement; this is flagged so the acting agent runs the check rather than assuming.
- Recommendation: Run Lighthouse / a CrUX or WebPageTest pass on the dashboard and the landing; check INP on the Issues stream under load and CLS as reactive lists hydrate.
- Verify the fix: Lighthouse mobile + desktop at the 75th percentile, LCP <= 2.5s, INP <= 200ms, CLS <= 0.1.
- Related: none.

## Dimension notes

- **Usability and Heuristics (73)**: Status visibility is strong (skeletons, live
  dots, "Saving..." states) and the project delete/transfer confirm is exemplary,
  but `USE-001` (one-click destructive deletes) is a High that touches many
  surfaces, and `USE-002` (no success feedback), `USE-003` (`<details>` dismissal),
  and `USE-004` (no error boundary) compound it.
- **Accessibility and Inclusive Design (76)**: Focus rings, icon labels, semantic
  controls, and zoom support are right (strengths). Held down by `FRM-001`
  (placeholder-only search), `ACC-001` (no reduced-motion), the mobile-nav gap's
  operability impact (`JRN-001`), and that real contrast/focus order is unverified
  (mark those Suspected, run axe + a contrast tool on the running app).
- **User Journeys and Flows (78)**: The activation journey is the product's
  standout (strength), and triage (resolve/ignore, reversible, so no confirm
  needed) is clean. The score is a C only because `JRN-001` blocks every journey on
  mobile.
- **Process and Workflow Efficiency (82)**: Flows are lean, few steps, smart
  defaults (PII scrubbing on by default, derived slugs), no swivel-chair re-entry.
  The one "waste" is inverted: actions are too frictionless (no guard on deletes).
- **Interaction and Visual Design (85)**: A coherent shadcn-svelte system with real
  hover/focus/disabled/loading/empty states and polished activation and landing
  surfaces.
- **Information Architecture and Navigation (80)**: Desktop nav is clear, with
  active-state and plain labels; the score reflects that the same nav is missing on
  mobile (`JRN-001`/`IA-001`).
- **Content and UX Writing (80)**: Buttons name outcomes ("Create account," "New
  project," "Start tracking errors"), empty states teach the next step; docked by
  `CNT-001` (raw error strings).
- **Onboarding, Conversion and Engagement (88)**: The highest dimension, a guided
  checklist, per-platform setup, and a live first-event confirmation put activation
  ahead of most tools in the category.
- **Forms and Input (80)**: Auth forms are exemplary; `FRM-001` (placeholder-only
  search) and the absence of `autocomplete` on the few address-like fields are the
  gaps. Validation is generally inline and input is constrained by type.
- **Performance and Responsiveness (78)**: Good perceived performance and a
  zoom-friendly viewport; `PRF-001` defers the numeric verdict to a real
  measurement.
- **Trust, Ethics and Transparency (90)**: Self-hosted, first-party, no deceptive
  patterns, real identity and license; only the leaked raw errors (`CNT-001`)
  slightly dent credibility.

## Remediation plan

- **Quick wins** (High/Critical, Confirmed, S): none are S; the two High findings
  are M (see Plan now). Smallest high-value items: `CNT-001`, `FRM-001`.
- **Plan now** (High/Critical, M/L; then high-value Mediums), suggested order:
  `USE-001` (destructive confirm) -> `JRN-001` (mobile nav) -> `USE-002` (success
  toasts) -> `CNT-001` (friendly load errors) -> `USE-004` (error boundary) ->
  `FRM-001` (search labels).
- **Verify first** (Suspected, needs the running product or a tool): `PRF-001`
  (Lighthouse/CrUX), plus the runtime contrast and focus-order checks noted under
  Accessibility.
- **Backlog** (Low): `ACC-001` (reduced-motion), `USE-003` (`<details>` dismissal).

## Scope and limitations

- The product **was run** (a local SvelteKit preview) and the core journeys were
  walked: signup -> onboarding -> create project -> first event (a real event was
  sent to confirm the live verification), the Overview (desktop and 375px mobile),
  Issues, the Help menu, and the landing page. The auth, project-settings, alert,
  team, and dashboards flows were read in source, not all walked at runtime.
- Runtime-only properties were **not** measured: real color contrast, focus order
  under a screen reader, and Core Web Vitals. Findings that depend on these are
  marked Suspected (`PRF-001`) or noted in the Accessibility dimension note.
- Assumed persona and context: a developer/SRE on desktop, with occasional mobile.
  If the product is intended to be desktop-only by design, `JRN-001` drops from
  High toward Medium, but the absence of any mobile fallback (not even a "best
  viewed on desktop" note) argues against that.
- The dashboard's own dev server showed an SSR hiccup on hard reload during the
  session; that is a development-mode artifact and was not treated as a production
  UX finding, but it reinforces `USE-004` (have a real error page).

## How to use this report (for the acting agent)

1. Triage by severity and confidence. Confirmed Critical and High are safe to act
   on now, in the order in "What to fix first". Re-verify any Suspected finding
   (run the product, run the check, or test with users) before changing anything.
2. Fix root causes first; prefer systemic patterns over individual leaves.
3. Preserve the strengths; do not flatten them while fixing other issues.
4. Confirm the stated assumption on Likely findings before acting.
5. One finding, one change, verified: after each fix run its "Verify the fix" step;
   keep changes atomic and traceable to the finding ID.
6. Do not widen scope silently; note adjacent issues rather than sprawling into a
   redesign.
7. Re-run the audit to measure progress; confirm findings are resolved, not
   relocated, and watch for regressions in the strengths.
