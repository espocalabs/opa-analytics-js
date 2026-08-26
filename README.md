# Opa Analytics SDK

First-party, cookieless-friendly browser analytics for [Opa](https://opa.sh) —
click attribution, `identify` / `track` for conversions, and automatic outbound
link decoration. Ships as **one package** — `@opa.sh/analytics` — with the
framework bindings split across import subpaths, so you `npm i` once and import
only the entry your stack needs.

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
captures the click id from the URL / first-party cookie, and exposes
`window.opa`:

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

The tracker posts to `POST /v1/track/collect` on `https://api.opa.sh`, sending
your public site key via the `x-opa-site-key` header (or in the JSON body when
falling back to `navigator.sendBeacon`). Every method is SSR-safe and never
throws to the caller.

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
tracker for the page if you do not need the `useOpa()` context.

## `@opa.sh/analytics/next`

```bash
npm i @opa.sh/analytics react next
```

```tsx
// app/layout.tsx
import { OpaProvider } from "@opa.sh/analytics/next";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <OpaProvider config={{ key: "opa_pub_xxx" }}>{children}</OpaProvider>
      </body>
    </html>
  );
}
```

The `next` subpath is browser-only — it re-exports the client components from
`@opa.sh/analytics/react` with the `"use client"` boundary already applied.

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
