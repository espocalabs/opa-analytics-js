/**
 * Preloaded by `bun test` (see bunfig.toml).
 *
 * Registers a happy-dom `window`/`document` globally so component tests
 * (React Testing Library) can render. Mirrors packages/ui/tests/dom-setup.ts:
 * restore the native Fetch API after registering, because happy-dom replaces
 * it with its own polyfills.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const nativeFetchApi = {
	fetch: globalThis.fetch,
	Request: globalThis.Request,
	Response: globalThis.Response,
	Headers: globalThis.Headers,
};

GlobalRegistrator.register({ url: "http://localhost/" });

Object.assign(globalThis, nativeFetchApi);
