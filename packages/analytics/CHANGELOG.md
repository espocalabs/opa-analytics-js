# Changelog

All notable changes to `@opa.sh/analytics` are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.0]

### Changed

- **Anonymous-first identify and events.** `identify()` now sends
  `POST /v1/track/identify` with `anonymousId`, `externalId`, optional
  `clickId`, and a shallow `traits` bag containing `email`/`name`/`avatar`
  plus any extra caller traits; it no longer emits a lead/conversion event.
  `track()` now sends `POST /v1/track/event` with a fresh `eventId`, the
  stable browser `anonymousId`, optional properties, optional `clickId`, and
  the most recent in-memory `externalId` when one was identified on the same
  tracker instance.
- `identifyEventName` is now a deprecated no-op. It remains in the type for
  compile compatibility, but `identify()` no longer creates an event whose
  name can be customized.
- **Pre-identify event capture.** `track()` and declarative
  `data-opa-event` clicks no longer require a prior `identify()` or click
  attribution; anonymous events send as long as consent and opt-out gates allow
  capture.
- **Consent and opt-out gates are absolute.** `consent: "denied"`,
  `setConsent(false)`, and `localStorage.opa_ignore = "true"` block manual
  calls, autocapture, declarative events, outbound decoration, ID generation,
  and transport. Denied/ignored states erase analytics cookies and getters
  return `null`; granting consent again creates a fresh anonymous identity.

### Added

- `tracker.resetIdentity({ rotateAnonymous = true })` clears the stored
  external id and session while preserving click attribution; by default it
  also rotates `opa_vid`.
- `tracker.resetAttribution()` clears only click attribution.
- The new reset methods are exposed through the core tracker, React/Next
  clients, and the browser `window.opa` surface.

## [0.3.1]

### Fixed

- **README install commands.** The `/react` and `/next` sections showed
  `npm i @opa.sh/analytics react` / `... react next` — misleading, since
  `react`/`next` are peer dependencies you already have and the framework
  bindings ship as import subpaths of the single package. Corrected to
  `npm i @opa.sh/analytics`.
- **`data-domains` docs.** Clarified that it drives cross-domain outbound-link
  decoration (appending `opa_id` to links pointing at those domains so
  attribution survives a jump to a domain the first-party cookie can't reach),
  not site-key access control.

## [0.3.0]

### Added

- **Automatic pageview autocapture.** Fires one pageview on initial load
  (deferred until the tab is visible) and one more on every client-side SPA
  navigation (`history.pushState` patch + `popstate`), feeding a new
  `POST /v1/track/pageview` endpoint. Carries a PII-free anonymous visitor id
  (`opa_vid`), a session id that rotates after 30min inactivity or a new UTM
  campaign, device/locale metadata, and known UTM / ad-click ids (`gclid`,
  `fbclid`, `ttclid`, `msclkid`, `gad_source`, `wbraid`, `gbraid`,
  `kwai_click_id`, plus a long-tail bag). On by default; disable with
  `trackPageviews: false` / `data-track-pageviews="false"`. Excludes
  localhost/`127.0.0.1`/`file:`, headless automation, and an `opa_ignore`
  opt-out flag by default.
- `tracker.pageview(overrides?)` and `tracker.getVisitorId()` on the core
  tracker, `window.opa.pageview()`/`window.opa.getVisitorId()` on the CDN
  bundle, and `pageview`/`getVisitorId` on `useOpa()`'s client.
- `@opa.sh/analytics/next` now ships a real Next.js App Router-aware
  `<OpaAnalytics>` (`usePathname()` + `useSearchParams()`, Suspense-isolated)
  as a reliability net for client-side route changes, alongside the core's
  own `history.pushState` patch.
- **Custom metadata (`props`) on pageviews.** `PageviewPayload`/
  `PageviewOverrides` gained `props?: Record<string, unknown>` (server caps
  it at 8KB). Set tracker-wide defaults via `TrackerConfig.props` /
  `data-props` (JSON) at init, update them any time with
  `tracker.setProps(props)` / `window.opa.setProps(props)` (shallow-merges,
  instance-scoped), and/or pass a per-call override via
  `pageview({ props })` — per-call keys win over the defaults. Every
  pageview (manual and autocaptured) sends the merged bag; omitted entirely
  when empty. `reset()` restores the config/`data-props` defaults, dropping
  anything added via `setProps()`.
- **Declarative click tracking (`data-opa-event`).** Zero-JS sugar over
  `track()` — tag any element `data-opa-event="name"` plus any number of
  `data-opa-*` attributes (kebab-case -> camelCase, e.g.
  `data-opa-plano-anual` -> `planoAnual`) and a click anywhere inside it
  fires `track(name, metadata)` through the exact same conversion pipeline,
  with the exact same requirements: a `clickId` and a prior `identify()`.
  One delegated bubble-phase `click` listener on `document` using
  `closest("[data-opa-event]")`, so it works for elements added later /
  SPA re-renders with no extra wiring. On by default (`trackClicks: true` /
  `data-track-clicks`) since it only ever fires on elements explicitly
  tagged for it; respects the same localhost/automation/opt-out exclusions
  as pageview autocapture.

### Notes

- Mounting both `<OpaAnalytics>` and `<OpaProvider>` (react or next subpath)
  in the same tree creates two independent tracker instances and
  double-fires every pageview — use one or the other, not both. See the
  README for the recommended pattern.

## [0.2.0]

Unified `@opa.sh/analytics` package with `/react` and `/next` subpaths;
prior versions were split across separate packages.
