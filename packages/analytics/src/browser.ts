import { createTracker } from "./create-tracker";
import type {
	AttributionModel,
	ConsentMode,
	TrackerConfig,
	TrackerCookieConfig,
} from "./types";

/**
 * Browser CDN entry point. esbuild bundles this file into the minified IIFE
 * served at `GET /sdk.js` (see packages/tracker-core/scripts/build-sdk.ts).
 *
 * A customer drops a single `<script>` tag on their site; on load this reads
 * config from the tag's `data-*` attributes, spins up the core tracker, and
 * exposes `window.opa = { identify, track, getClickId, setConsent, reset }`.
 * Nothing here is app-specific — all attribution logic lives in the core.
 */

/** The public surface assigned to `window.opa`. Mirrors the core tracker minus
 * the internal `init`/`ready` plumbing that a script-tag user never calls. */
export type OpaGlobal = {
	identify: ReturnType<typeof createTracker>["identify"];
	track: ReturnType<typeof createTracker>["track"];
	getClickId: ReturnType<typeof createTracker>["getClickId"];
	setConsent: ReturnType<typeof createTracker>["setConsent"];
	reset: ReturnType<typeof createTracker>["reset"];
	resetIdentity: ReturnType<typeof createTracker>["resetIdentity"];
	resetAttribution: ReturnType<typeof createTracker>["resetAttribution"];
	pageview: ReturnType<typeof createTracker>["pageview"];
	getVisitorId: ReturnType<typeof createTracker>["getVisitorId"];
	setProps: ReturnType<typeof createTracker>["setProps"];
};

/** Raw `data-*` values read off the script tag, before any parsing. Every
 * field is optional — an absent attribute reads back as `null`. Kept as a
 * plain record so the parser is a pure function, testable without a DOM. */
export type ScriptAttributes = {
	apiHost?: string | null;
	key?: string | null;
	attributionModel?: string | null;
	cookieOptions?: string | null;
	domains?: string | null;
	consent?: string | null;
	queryParam?: string | null;
	trackPageviews?: string | null;
	hashRouting?: string | null;
	captureLocalhost?: string | null;
	props?: string | null;
	trackClicks?: string | null;
};

function cleanString(value: string | null | undefined): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function parseAttributionModel(
	value: string | null | undefined,
): AttributionModel | undefined {
	const clean = cleanString(value);
	if (clean === "last-click" || clean === "first-click") {
		return clean;
	}
	return undefined;
}

function parseConsent(
	value: string | null | undefined,
): ConsentMode | undefined {
	const clean = cleanString(value);
	if (clean === "default" || clean === "denied") {
		return clean;
	}
	return undefined;
}

function parseFlag(value: string | null | undefined): boolean | undefined {
	const clean = cleanString(value);
	if (clean === "true") {
		return true;
	}
	if (clean === "false") {
		return false;
	}
	return undefined;
}

function parseJson(value: string | null | undefined): unknown {
	const clean = cleanString(value);
	if (clean === undefined) {
		return undefined;
	}
	try {
		return JSON.parse(clean);
	} catch {
		// Malformed JSON in an attribute must never break init.
		return undefined;
	}
}

function parseCookieOptions(
	value: string | null | undefined,
): TrackerCookieConfig | undefined {
	const parsed = parseJson(value);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return undefined;
	}
	const record = parsed as Record<string, unknown>;
	const cookie: TrackerCookieConfig = {};
	if (typeof record.domain === "string") {
		cookie.domain = record.domain;
	}
	if (typeof record.path === "string") {
		cookie.path = record.path;
	}
	if (
		typeof record.expiresInDays === "number" &&
		Number.isFinite(record.expiresInDays)
	) {
		cookie.expiresInDays = record.expiresInDays;
	}
	return Object.keys(cookie).length > 0 ? cookie : undefined;
}

function parseProps(
	value: string | null | undefined,
): Record<string, unknown> | undefined {
	const parsed = parseJson(value);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return undefined;
	}
	return parsed as Record<string, unknown>;
}

function parseDomains(value: string | null | undefined): string[] | undefined {
	const clean = cleanString(value);
	if (clean === undefined) {
		return undefined;
	}
	const parsed = parseJson(clean);
	let list: string[] = [];
	if (Array.isArray(parsed)) {
		list = parsed.filter((item): item is string => typeof item === "string");
	} else {
		// Tolerate a bare comma-separated list ("a.com, b.com") as a fallback
		// for anyone who forgets the JSON array brackets.
		list = clean.split(",");
	}
	const cleaned = list
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Pure `data-*` → `TrackerConfig` mapping. Only fields with a valid value are
 * set, so anything absent or malformed falls through to the core defaults.
 * Extracted from the DOM so it can be unit-tested in isolation.
 */
export function parseScriptConfig(attrs: ScriptAttributes): TrackerConfig {
	const config: TrackerConfig = {};

	const apiHost = cleanString(attrs.apiHost);
	if (apiHost !== undefined) {
		config.apiHost = apiHost;
	}

	const key = cleanString(attrs.key);
	if (key !== undefined) {
		config.key = key;
	}

	const attributionModel = parseAttributionModel(attrs.attributionModel);
	if (attributionModel !== undefined) {
		config.attributionModel = attributionModel;
	}

	const cookie = parseCookieOptions(attrs.cookieOptions);
	if (cookie !== undefined) {
		config.cookie = cookie;
	}

	const outboundDomains = parseDomains(attrs.domains);
	if (outboundDomains !== undefined) {
		config.outboundDomains = outboundDomains;
	}

	const consent = parseConsent(attrs.consent);
	if (consent !== undefined) {
		config.consent = consent;
	}

	const queryParam = cleanString(attrs.queryParam);
	if (queryParam !== undefined) {
		config.queryParam = queryParam;
	}

	const trackPageviews = parseFlag(attrs.trackPageviews);
	if (trackPageviews !== undefined) {
		config.trackPageviews = trackPageviews;
	}

	const hashRouting = parseFlag(attrs.hashRouting);
	if (hashRouting !== undefined) {
		config.hashRouting = hashRouting;
	}

	const captureLocalhost = parseFlag(attrs.captureLocalhost);
	if (captureLocalhost !== undefined) {
		config.captureLocalhost = captureLocalhost;
	}

	const props = parseProps(attrs.props);
	if (props !== undefined) {
		config.props = props;
	}

	const trackClicks = parseFlag(attrs.trackClicks);
	if (trackClicks !== undefined) {
		config.trackClicks = trackClicks;
	}

	return config;
}

/** Read the raw `data-*` attributes off the owning `<script>` element. */
export function readScriptAttributes(
	el: { getAttribute(name: string): string | null } | null,
): ScriptAttributes {
	if (!el) {
		return {};
	}
	return {
		apiHost: el.getAttribute("data-api-host"),
		key: el.getAttribute("data-key"),
		attributionModel: el.getAttribute("data-attribution-model"),
		cookieOptions: el.getAttribute("data-cookie-options"),
		domains: el.getAttribute("data-domains"),
		consent: el.getAttribute("data-consent"),
		queryParam: el.getAttribute("data-query-param"),
		trackPageviews: el.getAttribute("data-track-pageviews"),
		hashRouting: el.getAttribute("data-hash-routing"),
		captureLocalhost: el.getAttribute("data-capture-localhost"),
		props: el.getAttribute("data-props"),
		trackClicks: el.getAttribute("data-track-clicks"),
	};
}

/** Locate the `<script>` tag that loaded this bundle: `document.currentScript`
 * when available, else the last script whose src points at `/sdk.js`. */
function findOwnScript(): {
	getAttribute(name: string): string | null;
} | null {
	if (typeof document === "undefined") {
		return null;
	}
	const current = document.currentScript;
	if (current) {
		return current;
	}
	try {
		const scripts = document.getElementsByTagName("script");
		for (let i = scripts.length - 1; i >= 0; i--) {
			const src = scripts[i]?.getAttribute("src");
			if (src && /\/sdk\.js(\?|$)/.test(src)) {
				return scripts[i];
			}
		}
	} catch {
		// Fall through to null — init still runs with defaults.
	}
	return null;
}

/** Drain a pre-init command queue: `window.opa = window.opa || []` lets a page
 * call `window.opa.push(["track", "signup"])` before the script finishes
 * loading. Once the real tracker is ready we replay those calls in order. */
function drainQueue(tracker: OpaGlobal, queued: unknown): void {
	if (!Array.isArray(queued)) {
		return;
	}
	for (const entry of queued) {
		if (!Array.isArray(entry) || entry.length === 0) {
			continue;
		}
		const [method, ...args] = entry as [keyof OpaGlobal, ...unknown[]];
		const fn = tracker[method];
		if (typeof fn === "function") {
			try {
				(fn as (...a: unknown[]) => unknown)(...args);
			} catch {
				// A bad queued call must not abort the rest of the queue.
			}
		}
	}
}

/** Wire up `window.opa` from the script tag's config. Idempotent-ish: safe to
 * call once at load; a second call rebuilds the tracker. */
export function bootstrap(): OpaGlobal | undefined {
	if (typeof window === "undefined") {
		return undefined;
	}
	const script = findOwnScript();
	const config = parseScriptConfig(readScriptAttributes(script));
	const tracker = createTracker(config);
	const surface: OpaGlobal = {
		identify: tracker.identify,
		track: tracker.track,
		getClickId: tracker.getClickId,
		setConsent: tracker.setConsent,
		reset: tracker.reset,
		resetIdentity: tracker.resetIdentity,
		resetAttribution: tracker.resetAttribution,
		pageview: tracker.pageview,
		getVisitorId: tracker.getVisitorId,
		setProps: tracker.setProps,
	};

	const existing = (window as unknown as { opa?: unknown }).opa;
	(window as unknown as { opa: OpaGlobal }).opa = surface;
	drainQueue(surface, existing);
	return surface;
}

bootstrap();
