# Opa Analytics SDK

First-party, cookieless-friendly browser analytics for [Opa](https://opa.sh) —
click attribution, `identify` / `track` for conversions, automatic PII-free
pageview capture, and automatic outbound link decoration. Ships as **one
package** — `@opa.sh/analytics` — with the framework bindings split across
import subpaths, so you `npm i` once and import only the entry your stack
needs.

| Import | What it is |
| --- | --- |
| [`@opa.sh/analytics`](packages/analytics/src/index.ts) | Framework-agnostic browser core: `createTracker`, cookie/localStorage persistence, `sendBeacon`/`fetch` transport, outbound link decoration. |
| [`@opa.sh/analytics/react`](packages/analytics/src/react) | React bindings: `<OpaProvider>`, `useOpa()`, `<OpaAnalytics>`. |
| [`@opa.sh/analytics/next`](packages/analytics/src/next) | Next.js (App Router) client bindings — re-exports the React API with `"use client"`. |

`react` and `next` are **optional peer dependencies**: the vanilla core pulls in
neither, and you only need them installed to use the matching subpath.

Full docs: **https://opa.sh/docs/sdks/conversions**

## Script tag (no build step)

Drop one tag on any page. On load it reads config from `data-*` attributes,
captures the click id from the URL / first-party cookie, fires an automatic
pageview, and exposes `window.opa`:

```html
<script
  src="https://cdn.opa.sh/sdk.js"
  data-key="opa_pub_xxx"
  data-domains='["example.com"]'
  data-attribution-model="last-click"
  async
></script>

<script>
  // Queue calls before the script finishes loading, or call window.opa.* after.
  window.opa.identify({ externalId: "user_123", email: "a@b.com" });
  window.opa.track("signup");
</script>
```

### Automatic pageview capture

On by default — no code required. The SDK fires one pageview on initial load
(deferred until the tab is actually visible, so prerendered/background tabs
don't count) and one more on every client-side SPA navigation, detected via a
`history.pushState` patch + `popstate` (never `replaceState`, which would
double-count non-navigational URL touch-ups). Each pageview carries a
PII-free, cookie-persisted anonymous visitor id, a session id that rotates
after 30 minutes of inactivity or a new UTM campaign, device/locale
metadata, and any UTM / ad-click ids (`gclid`, `fbclid`, `ttclid`, `msclkid`,
and more) found in the URL — never raw IP or user-agent strings; the server
derives geo and bot classification from the request itself. Pageviews POST to
`/v1/track/pageview` and never require a click id or a prior `identify()`.

Dev/QA traffic is excluded automatically: `localhost` / `127.0.0.1` / `file:`
pages, headless automation (`navigator.webdriver`, Cypress, PhantomJS,
Nightmare), and a per-visitor opt-out (`localStorage.setItem("opa_ignore",
"true")`).

| Attribute | Default | What it does |
| --- | --- | --- |
| `data-track-pageviews` | `true` | Set to `"false"` to disable autocapture entirely (the manual `pageview()` API still works). |
| `data-hash-routing` | `false` | Set to `"true"` to also treat `#/route` changes as navigation (hash-based routers). |
| `data-capture-localhost` | `false` | Set to `"true"` to capture pageviews on `localhost` / `127.0.0.1` / `file:` too. |

```html
<script
  src="https://cdn.opa.sh/sdk.js"
  data-key="opa_pub_xxx"
  data-hash-routing="true"
  async
></script>

<script>
  // Call manually any time — e.g. a virtual pageview inside a wizard step.
  window.opa.pageview({ pathname: "/wizard/step-2", title: "Step 2" });
  window.opa.getVisitorId(); // the anonymous visitor id backing every pageview
</script>
```

### Custom metadata (props)

Every pageview can carry a free-form JSON metadata bag (`props`, capped at
8KB server-side) — the pageview equivalent of the `properties` you already
pass to `track()`. There are three ways to set it, and they merge together
(per-call wins, key by key):

1. **Site-wide defaults at init**, via `data-props` (JSON) or `config.props`.
2. **Update the defaults at runtime**, via `window.opa.setProps(props)` /
   `tracker.setProps(props)` — shallow-merges into the existing bag, so
   `setProps({ seats: 3 })` doesn't drop a `plan` key set earlier. Scoped to
   that tracker instance only.
3. **A one-off override**, via `pageview({ props })` on a manual call.

`props` is entirely optional and omitted from the payload when empty.
`tracker.reset()` restores the `data-props`/`config.props` defaults, dropping
anything added later via `setProps()` — treat `setProps()` as per-session
context, and `data-props`/`config.props` as static site-level defaults (env,
app version, etc.) that should survive a reset.

```html
<script
  src="https://cdn.opa.sh/sdk.js"
  data-key="opa_pub_xxx"
  data-props='{"env":"production"}'
  async
></script>

<script>
  window.opa.setProps({ plan: "pro" }); // e.g. once you know the visitor's plan
  window.opa.pageview({ props: { step: "checkout" } }); // one-off override
</script>
```

### Declarative click tracking (`data-opa-event`)

A zero-JS alternative to calling `opa.track()` by hand. Tag any element:

```html
<a
  href="https://wa.me/5511999999999"
  data-opa-event="whatsapp_click"
  data-opa-oferta="black-friday"
  data-opa-plano="pro"
>
  Falar no WhatsApp
</a>
```

A click anywhere inside that element fires
`track("whatsapp_click", { oferta: "black-friday", plano: "pro" })` — it is
**sugar over the existing `track()`**, the exact same conversion pipeline
with the exact same requirements: a click id and a prior `identify()`. A tap
on a tagged element before `identify()` has run (or with no click id) is a
silent no-op, exactly like calling `track()` directly would be.

Every `data-opa-*` attribute other than `data-opa-event` becomes a metadata
key, kebab-case converted to camelCase the same way the DOM's own `.dataset`
would: `data-opa-plano-anual="true"` → `{ planoAnual: "true" }`.

One delegated listener on `document` (bubble phase, `closest("[data-opa-event]")`)
handles it, so it works for elements added later or re-rendered by a SPA —
no re-binding needed. On by default; disable with `data-track-clicks="false"`
/ `trackClicks: false` (safe to leave on, since it only ever fires on
elements you explicitly tag). Respects the same localhost/automation/opt-out
exclusions as pageview autocapture.

### TypeScript

The CDN bundle is plain JavaScript — it attaches `window.opa` at runtime and
ships no type declarations, so TypeScript doesn't know the global exists. Add a
declaration file anywhere your `tsconfig.json` picks up (any `.d.ts` under an
`include`d path — e.g. `src/types/opa.d.ts`):

```ts
// src/types/opa.d.ts
export {}; // make this file a module so `declare global` augments, not replaces

type OpaIdentifyInput = {
  externalId: string;
  email?: string;
  name?: string;
  avatar?: string;
  [key: string]: unknown;
};

type OpaGlobal = {
  identify: (input: OpaIdentifyInput) => Promise<void>;
  track: (eventName: string, properties?: Record<string, unknown>) => Promise<void>;
  getClickId: () => string | null;
  setConsent: (granted: boolean) => void;
  reset: () => void;
  pageview: (overrides?: {
    url?: string;
    pathname?: string;
    host?: string;
    referrer?: string;
    title?: string;
    props?: Record<string, unknown>;
  }) => Promise<void>;
  getVisitorId: () => string | null;
  setProps: (props: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    // Present once cdn.opa.sh/sdk.js has loaded. It's optional because the
    // script is async — guard with `window.opa?.track(...)`, or use the
    // pre-load queue: `(window.opa ||= []).push(["track", "signup"])`.
    opa?: OpaGlobal;
  }
}
```

Then it type-checks with no import and no npm install:

```ts
window.opa?.identify({ externalId: "user_123", email: "a@b.com" });
window.opa?.track("signup", { plan: "pro" });
```

> Prefer real imports? Install the npm package instead (`@opa.sh/analytics`,
> with the `/react` and `/next` subpaths below) — it bundles its own `.d.ts`
> and needs no global augmentation.

## `@opa.sh/analytics` (core)

```bash
npm i @opa.sh/analytics
```

```ts
import { createTracker } from "@opa.sh/analytics";

const opa = createTracker({
  key: "opa_pub_xxx",
  outboundDomains: ["example.com"],
});

await opa.identify({ externalId: "user_123", email: "a@b.com" });
await opa.track("purchase", { plan: "pro", amount: 4900 });
```

The tracker posts `identify`/`track` events to `POST /v1/track/collect`, and
pageviews to `POST /v1/track/pageview`, both on `https://api.opa.sh`, sending
your public site key via the `x-opa-site-key` header (or in the JSON body when
falling back to `navigator.sendBeacon` / `fetch` with `keepalive`). Every
method is SSR-safe and never throws to the caller.

`createTracker()` fires automatic pageview capture and `data-opa-event`
click tracking the same way the CDN bundle does (see
[Automatic pageview capture](#automatic-pageview-capture) and
[Declarative click tracking](#declarative-click-tracking-data-opa-event)
above) — `trackPageviews`, `hashRouting`, `captureLocalhost`, `props`, and
`trackClicks` on `TrackerConfig` are the same knobs as the `data-*`
attributes.

## `@opa.sh/analytics/react`

```bash
npm i @opa.sh/analytics react
```

```tsx
import { OpaProvider, useOpa } from "@opa.sh/analytics/react";

function App() {
  return (
    <OpaProvider config={{ key: "opa_pub_xxx" }}>
      <Checkout />
    </OpaProvider>
  );
}

function Checkout() {
  const opa = useOpa();
  return <button onClick={() => opa.track("purchase")}>Buy</button>;
}
```

`<OpaAnalytics config={...} />` is a zero-render component that boots a single
tracker for the page if you do not need the `useOpa()` context — use it
**instead of** `<OpaProvider>`, not alongside it, since each creates its own
tracker instance and mounting both double-fires every pageview. Either way,
the tracker underneath fires the same automatic pageview capture as the core
package — SPA navigation is detected via the tracker's own `history.pushState`
patch, so plain React Router / Wouter / etc. work with no extra wiring.

## `@opa.sh/analytics/next`

```bash
npm i @opa.sh/analytics react next
```

```tsx
// app/layout.tsx
import { OpaAnalytics } from "@opa.sh/analytics/next";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <OpaAnalytics config={{ key: "opa_pub_xxx" }} />
        {children}
      </body>
    </html>
  );
}
```

`<OpaAnalytics>` is the one component this subpath rewrites: on top of the
core's `history.pushState`-based autocapture, it uses `usePathname()` +
`useSearchParams()` from `next/navigation` as a reliability net for App
Router client-side navigation, since raw `pushState` timing isn't guaranteed
to line up with it across Next versions.

`OpaProvider`/`useOpa` are re-exported as-is from `@opa.sh/analytics/react`
for apps that call `identify`/`track` from client components — their tracker
still autocaptures via the core's `history.pushState` patch on its own, just
without the extra `next/navigation` net. **Mount only one of
`<OpaAnalytics>` / `<OpaProvider>` per app** — each creates its own tracker
instance, so using both together double-fires every pageview. If you need
`useOpa()` *and* the App Router reliability net in the same tree, call
`createTracker()` yourself once and share it through your own context.

## Development

This is a [Bun](https://bun.sh) workspace.

```bash
bun install
bun run -F '*' build       # tsup → dist/ (ESM + CJS + .d.ts) for all packages
bun run -F '*' typecheck   # tsc --noEmit
bun run -F '*' test        # bun test
```

To regenerate the CDN bundle served at `/sdk.js`:

```bash
bun run --cwd packages/analytics build:sdk
```

## Releasing

Publishing is automated by [`.github/workflows/release.yml`](.github/workflows/release.yml),
which runs **only** when a `v*` tag is pushed. It builds the package (core +
`/react` + `/next` subpaths) and runs `npm publish --provenance` using the
`NPM_TOKEN` secret.

```bash
git tag v0.2.0
git push origin v0.2.0
```

## License

[MIT](LICENSE) © Espoca
