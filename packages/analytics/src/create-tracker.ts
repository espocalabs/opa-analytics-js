import { eraseCookie, readCookie, writeCookie } from "./cookie";
import {
	generateId,
	parseUtmAndClickIds,
	resolveSession,
	type SessionState,
	utmSignature,
} from "./ids";
import {
	closestAnchor,
	decorateAnchor,
	decorateOutboundLinks,
} from "./outbound";
import { createTransport, sendPageview } from "./transport";
import type {
	IdentifyInput,
	LeadPayload,
	PageviewOverrides,
	PageviewPayload,
	Tracker,
	TrackerConfig,
	TrackProperties,
} from "./types";

const DEFAULT_API_HOST = "https://api.opa.sh";
const DEFAULT_QUERY_PARAM = "opa_id";
const DEFAULT_EXPIRES_IN_DAYS = 90;
const DEFAULT_PATH = "/";
const DEFAULT_IDENTIFY_EVENT = "identify";
const VISITOR_COOKIE = "opa_vid";
const SESSION_COOKIE = "opa_sid";
/** Absorbs `pushState` + `popstate` firing in the same tick, and React
 * StrictMode double-invokes in dev: rapid-fire SPA navigation triggers get
 * coalesced into a single pageview for whichever path is current once
 * things settle. */
const COALESCE_MS = 1000;

/**
 * `history.pushState` is monkey-patched exactly once per page, module-level
 * (not per tracker instance) — multiple `createTracker()` calls on the same
 * page (e.g. a manual tracker alongside `<OpaProvider>`) share this one
 * patch and fan out to their own listeners, instead of each instance
 * wrapping the previous instance's already-wrapped function.
 */
type NavListener = () => void;
let historyPatched = false;
const navListeners = new Set<NavListener>();

function ensureHistoryPatched(): void {
	if (historyPatched) {
		return;
	}
	if (
		typeof window === "undefined" ||
		typeof window.history === "undefined" ||
		typeof window.history.pushState !== "function"
	) {
		return;
	}
	try {
		const original = window.history.pushState.bind(window.history);
		window.history.pushState = function patchedPushState(
			...args: Parameters<History["pushState"]>
		) {
			const result = original(...args);
			for (const listener of navListeners) {
				try {
					listener();
				} catch {
					// One listener throwing must not break the others.
				}
			}
			return result;
		} as History["pushState"];
		historyPatched = true;
	} catch {
		// Frozen/non-configurable `history.pushState` (rare, some embeds) —
		// SPA autocapture just won't fire; init/manual pageview() still work.
	}
}

/** Test-only: undo the module-level `history.pushState` patch so test files
 * can assert on binding behavior without leaking state across tests. */
export function resetPageviewAutocaptureForTests(): void {
	historyPatched = false;
	navListeners.clear();
}

function isDev(): boolean {
	try {
		return (
			typeof process !== "undefined" && process.env.NODE_ENV !== "production"
		);
	} catch {
		return false;
	}
}

function warn(message: string): void {
	if (
		!isDev() ||
		typeof console === "undefined" ||
		typeof console.warn !== "function"
	) {
		return;
	}
	console.warn(message);
}

function readQueryParam(name: string): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		const url = new URL(window.location.href);
		const value = url.searchParams.get(name);
		if (typeof value !== "string") {
			return null;
		}
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	} catch {
		return null;
	}
}

function omitEmpty(
	record: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (value !== undefined) {
			out[key] = value;
		}
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function isLocalhostHostname(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return (
		host === "localhost" ||
		host === "::1" ||
		host === "[::1]" ||
		/^127(\.\d{1,3}){3}$/.test(host)
	);
}

function isAutomationEnv(): boolean {
	try {
		if (
			typeof navigator !== "undefined" &&
			(navigator as { webdriver?: boolean }).webdriver
		) {
			return true;
		}
		if (typeof window === "undefined") {
			return false;
		}
		const w = window as unknown as {
			_phantom?: unknown;
			__nightmare?: unknown;
			Cypress?: unknown;
		};
		return Boolean(w._phantom || w.__nightmare || w.Cypress);
	} catch {
		return false;
	}
}

function isOptedOut(): boolean {
	try {
		return (
			typeof localStorage !== "undefined" &&
			localStorage.getItem("opa_ignore") === "true"
		);
	} catch {
		return false;
	}
}

/** Autocapture exclusions shared by pageviews AND declarative `data-opa-event`
 * click tracking: dev/QA localhost, headless automation, and a per-visitor
 * opt-out flag. Checked before every pageview send — manual and autocaptured
 * alike — so a real visit is never captured from an excluded context just
 * because a caller invoked `pageview()` directly. */
function isCaptureExcluded(captureLocalhost: boolean): boolean {
	try {
		if (typeof window === "undefined" || typeof document === "undefined") {
			return true;
		}
		const { protocol, hostname } = window.location;
		if (protocol === "file:" && !captureLocalhost) {
			return true;
		}
		if (isLocalhostHostname(hostname) && !captureLocalhost) {
			return true;
		}
		if (isAutomationEnv()) {
			return true;
		}
		if (isOptedOut()) {
			return true;
		}
		return false;
	} catch {
		return true;
	}
}

function safeTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
	} catch {
		return "";
	}
}

function safeDoNotTrack(): string | null {
	try {
		const value =
			navigator.doNotTrack ??
			(window as unknown as { doNotTrack?: string | null }).doNotTrack ??
			null;
		return typeof value === "string" ? value : null;
	} catch {
		return null;
	}
}

function safeGlobalPrivacyControl(): boolean {
	try {
		return Boolean(
			(navigator as unknown as { globalPrivacyControl?: boolean })
				.globalPrivacyControl,
		);
	} catch {
		return false;
	}
}

const DATA_OPA_PREFIX = "data-opa-";

/** `plano-anual` -> `planoAnual` — same convention the DOM's own `.dataset`
 * uses, applied manually (via `getAttribute`/`getAttributeNames`, not
 * `.dataset`) so this works against plain objects in tests too. */
function kebabToCamel(input: string): string {
	return input.replace(/-([a-z0-9])/g, (_match, char: string) =>
		char.toUpperCase(),
	);
}

/** Finds the closest ancestor (inclusive) carrying `data-opa-event`, given a
 * click's `event.target`. */
function closestTaggedElement(target: EventTarget | null): {
	getAttribute(name: string): string | null;
	getAttributeNames?: () => string[];
} | null {
	if (!target || typeof target !== "object") {
		return null;
	}
	const el = target as {
		closest?: (selector: string) => unknown;
	};
	if (typeof el.closest !== "function") {
		return null;
	}
	return el.closest("[data-opa-event]") as {
		getAttribute(name: string): string | null;
		getAttributeNames?: () => string[];
	} | null;
}

/** Every OTHER `data-opa-*` attribute on a tagged element becomes a metadata
 * key — `data-opa-plano-anual="pro"` -> `{ planoAnual: "pro" }`. */
function collectEventMetadata(el: {
	getAttribute(name: string): string | null;
	getAttributeNames?: () => string[];
}): Record<string, string> {
	const metadata: Record<string, string> = {};
	try {
		const names =
			typeof el.getAttributeNames === "function" ? el.getAttributeNames() : [];
		for (const name of names) {
			if (!name.startsWith(DATA_OPA_PREFIX) || name === "data-opa-event") {
				continue;
			}
			const key = kebabToCamel(name.slice(DATA_OPA_PREFIX.length));
			if (!key) {
				continue;
			}
			const value = el.getAttribute(name);
			if (value !== null) {
				metadata[key] = value;
			}
		}
	} catch {
		// Never throw from a click handler.
	}
	return metadata;
}

export function createTracker(config: TrackerConfig = {}): Tracker {
	const apiHost = config.apiHost ?? DEFAULT_API_HOST;
	const queryParam = config.queryParam ?? DEFAULT_QUERY_PARAM;
	const attributionModel = config.attributionModel ?? "last-click";
	const outboundDomains = config.outboundDomains ?? [];
	const identifyEventName = config.identifyEventName ?? DEFAULT_IDENTIFY_EVENT;
	const cookieDomain = config.cookie?.domain;
	const cookiePath = config.cookie?.path ?? DEFAULT_PATH;
	const expiresInDays = config.cookie?.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS;
	const trackPageviews = config.trackPageviews ?? true;
	const hashRouting = config.hashRouting ?? false;
	const captureLocalhost = config.captureLocalhost ?? false;
	const trackClicks = config.trackClicks ?? true;
	const initialProps: Record<string, unknown> =
		config.props && typeof config.props === "object" ? { ...config.props } : {};

	const siteKey =
		typeof config.key === "string" && config.key.trim().length > 0
			? config.key.trim()
			: undefined;

	let canPersist = (config.consent ?? "default") !== "denied";
	let memoryClickId: string | null = null;
	let currentExternalId: string | null = null;
	let memoryVisitorId: string | null = null;
	let memorySession: SessionState | null = null;
	let defaultProps: Record<string, unknown> = { ...initialProps };
	let ready = false;
	const readyQueue: Array<() => void> = [];
	let clickBound = false;
	let autocaptureBound = false;
	let eventClickBound = false;
	let lastFiredPath: string | null = null;
	let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

	const transport = createTransport(apiHost, siteKey);
	const cookieOptions = {
		domain: cookieDomain,
		path: cookiePath,
		expiresInDays,
	};

	function persist(value: string): void {
		if (!canPersist) {
			return;
		}
		writeCookie(queryParam, value, cookieOptions);
	}

	function decorate(): void {
		const clickId = memoryClickId;
		if (!clickId) {
			return;
		}
		decorateOutboundLinks(queryParam, clickId, outboundDomains);
	}

	function bindClickDecoration(): void {
		if (clickBound || outboundDomains.length === 0) {
			return;
		}
		if (typeof document === "undefined" || !document.addEventListener) {
			return;
		}
		clickBound = true;
		document.addEventListener(
			"click",
			(event) => {
				const clickId = memoryClickId;
				if (!clickId) {
					return;
				}
				const anchor = closestAnchor(event.target);
				if (!anchor) {
					return;
				}
				decorateAnchor(anchor, queryParam, clickId, outboundDomains);
			},
			true,
		);
	}

	function resolveVisitorId(): string | null {
		try {
			if (typeof document === "undefined") {
				return null;
			}
			if (memoryVisitorId) {
				return memoryVisitorId;
			}
			const stored = readCookie(VISITOR_COOKIE);
			const id = stored ?? generateId();
			memoryVisitorId = id;
			if (!stored && canPersist) {
				writeCookie(VISITOR_COOKIE, id, cookieOptions);
			}
			return id;
		} catch {
			return null;
		}
	}

	function readStoredSession(): SessionState | null {
		try {
			const raw = readCookie(SESSION_COOKIE);
			if (!raw) {
				return null;
			}
			const parsed = JSON.parse(raw) as Partial<SessionState>;
			if (
				typeof parsed.sessionId === "string" &&
				typeof parsed.lastActivity === "number" &&
				typeof parsed.utmSignature === "string"
			) {
				return parsed as SessionState;
			}
			return null;
		} catch {
			return null;
		}
	}

	function resolveSessionId(): string {
		const now = Date.now();
		const search = typeof window !== "undefined" ? window.location.search : "";
		const signature = utmSignature(parseUtmAndClickIds(search));
		const previous = memorySession ?? readStoredSession();
		const next = resolveSession({ previous, now, utmSignature: signature });
		memorySession = next;
		if (canPersist) {
			writeCookie(SESSION_COOKIE, JSON.stringify(next), cookieOptions);
		}
		return next.sessionId;
	}

	function normalizedPathname(): string {
		try {
			const loc = window.location;
			return hashRouting ? `${loc.pathname}${loc.hash}` : loc.pathname;
		} catch {
			return "";
		}
	}

	function collectPageviewPayload(
		overrides?: PageviewOverrides,
	): PageviewPayload | null {
		if (typeof window === "undefined" || typeof document === "undefined") {
			return null;
		}
		try {
			const loc = window.location;
			const utm = parseUtmAndClickIds(loc.search);
			const screen =
				typeof window.screen !== "undefined" ? window.screen : undefined;
			const payload: PageviewPayload = {
				event: "pageview",
				siteKey,
				anonId: resolveVisitorId() ?? "",
				sessionId: resolveSessionId(),
				url: overrides?.url ?? loc.href,
				pathname: overrides?.pathname ?? loc.pathname,
				host: overrides?.host ?? loc.host,
				referrer:
					overrides?.referrer ??
					(typeof document.referrer === "string" ? document.referrer : ""),
				title:
					overrides?.title ??
					(typeof document.title === "string" ? document.title : undefined),
				screenW: screen?.width ?? 0,
				screenH: screen?.height ?? 0,
				viewportW: window.innerWidth ?? 0,
				viewportH: window.innerHeight ?? 0,
				dpr: window.devicePixelRatio ?? 1,
				language:
					typeof navigator !== "undefined" && navigator.language
						? navigator.language
						: "",
				timezone: safeTimezone(),
				timezoneOffset: new Date().getTimezoneOffset(),
				...utm,
				dnt: safeDoNotTrack(),
				gpc: safeGlobalPrivacyControl(),
				consentState: canPersist ? "default" : "denied",
				ts: Date.now(),
			};
			const clickId = memoryClickId ?? readCookie(queryParam);
			if (clickId) {
				payload.clickId = clickId;
			}
			const mergedProps = omitEmpty({ ...defaultProps, ...overrides?.props });
			if (mergedProps) {
				payload.props = mergedProps;
			}
			return payload;
		} catch {
			return null;
		}
	}

	function setProps(props: Record<string, unknown>): void {
		try {
			defaultProps = { ...defaultProps, ...props };
		} catch {
			// Never throw to the caller.
		}
	}

	async function pageview(overrides?: PageviewOverrides): Promise<void> {
		try {
			if (!siteKey) {
				missingSiteKey();
				return;
			}
			if (isCaptureExcluded(captureLocalhost)) {
				return;
			}
			const payload = collectPageviewPayload(overrides);
			if (!payload) {
				return;
			}
			lastFiredPath = normalizedPathname();
			await sendPageview(apiHost, payload, siteKey);
		} catch {
			// Never throw to the caller.
		}
	}

	function fireInitialPageview(): void {
		if (!trackPageviews || isCaptureExcluded(captureLocalhost)) {
			return;
		}
		void pageview();
	}

	function scheduleAutoPageview(): void {
		if (!trackPageviews || isCaptureExcluded(captureLocalhost)) {
			return;
		}
		const path = normalizedPathname();
		if (path === lastFiredPath) {
			return;
		}
		if (coalesceTimer !== null) {
			clearTimeout(coalesceTimer);
		}
		coalesceTimer = setTimeout(() => {
			coalesceTimer = null;
			const finalPath = normalizedPathname();
			if (finalPath === lastFiredPath) {
				return;
			}
			void pageview();
		}, COALESCE_MS);
	}

	function bindInitialPageview(): void {
		if (!trackPageviews || typeof document === "undefined") {
			return;
		}
		if (document.visibilityState !== "visible") {
			const onVisible = () => {
				if (document.visibilityState === "visible") {
					document.removeEventListener("visibilitychange", onVisible);
					fireInitialPageview();
				}
			};
			document.addEventListener("visibilitychange", onVisible);
			return;
		}
		fireInitialPageview();
	}

	function bindAutocapture(): void {
		if (autocaptureBound || !trackPageviews) {
			return;
		}
		if (typeof window === "undefined" || !window.addEventListener) {
			return;
		}
		autocaptureBound = true;
		ensureHistoryPatched();
		navListeners.add(scheduleAutoPageview);
		// Never bind `replaceState` — most SPA routers (and our own outbound
		// decoration) use it for non-navigational URL touch-ups, which would
		// double-count pageviews.
		window.addEventListener("popstate", scheduleAutoPageview);
		if (hashRouting) {
			window.addEventListener("hashchange", scheduleAutoPageview);
		}
	}

	/**
	 * Declarative `data-opa-event` click tracking — sugar over `track()`, the
	 * SAME conversion pipeline with the SAME requirements: needs a `clickId`
	 * and a prior `identify()`, exactly like calling `track()` directly. A tap
	 * with no identify/clickId yet is a silent no-op, same as `track()` today.
	 *
	 * One delegated bubble-phase listener on `document` (works for elements
	 * added after the fact / SPA re-renders) using `closest("[data-opa-event]")`
	 * to find the tagged ancestor. Every other `data-opa-*` attribute on that
	 * element becomes a metadata key (kebab-case -> camelCase, e.g.
	 * `data-opa-plano-anual` -> `planoAnual`).
	 */
	function bindDeclarativeEventTracking(): void {
		if (eventClickBound || !trackClicks) {
			return;
		}
		if (typeof document === "undefined" || !document.addEventListener) {
			return;
		}
		eventClickBound = true;
		document.addEventListener("click", (event) => {
			try {
				if (isCaptureExcluded(captureLocalhost)) {
					return;
				}
				const el = closestTaggedElement(event.target);
				if (!el) {
					return;
				}
				const eventName = el.getAttribute("data-opa-event");
				if (!eventName) {
					return;
				}
				const metadata = collectEventMetadata(el);
				void track(eventName, metadata);
			} catch {
				// Never throw from a click handler.
			}
		});
	}

	function markReady(): void {
		ready = true;
		const queued = readyQueue.splice(0);
		for (const cb of queued) {
			try {
				cb();
			} catch {
				// A user callback throwing must not break the rest of the queue.
			}
		}
	}

	function init(): void {
		try {
			if (typeof document !== "undefined") {
				const fromUrl = readQueryParam(queryParam);
				const existing = readCookie(queryParam);
				const clickId =
					fromUrl && attributionModel === "first-click" && existing
						? existing
						: (fromUrl ?? existing);
				memoryClickId = clickId;
				if (clickId && canPersist && fromUrl) {
					if (attributionModel === "last-click" || !existing) {
						persist(clickId);
					}
				}
				decorate();
				bindClickDecoration();
				transport.bindUnload();
				bindAutocapture();
				bindInitialPageview();
				bindDeclarativeEventTracking();
			}
			markReady();
		} catch {
			markReady();
		}
	}

	function getClickId(): string | null {
		try {
			return memoryClickId ?? readCookie(queryParam);
		} catch {
			return null;
		}
	}

	async function postLead(payload: LeadPayload | null): Promise<void> {
		if (!payload) {
			return;
		}
		try {
			await transport.send(payload);
		} catch {
			// Transport already swallows; belt-and-suspenders.
		}
	}

	function missingClickId(method: string): void {
		if (typeof document !== "undefined") {
			warn(
				`[opa] ${method}() skipped: no click id. The /v1/track/collect endpoint requires clickId.`,
			);
		}
	}

	function missingSiteKey(): void {
		if (typeof document !== "undefined") {
			warn("[opa] sem site-key: configure data-key / key");
		}
	}

	function missingIdentify(): void {
		if (typeof document !== "undefined") {
			warn("[opa] track() antes de identify() — sem customer pra atribuir");
		}
	}

	async function identify(input: IdentifyInput): Promise<void> {
		try {
			if (!siteKey) {
				missingSiteKey();
				return;
			}
			currentExternalId = input.externalId;
			const clickId = getClickId();
			if (!clickId) {
				missingClickId("identify");
				return;
			}
			const { externalId, email, name, avatar, ...extra } = input;
			const metadata = omitEmpty(extra);
			const payload: LeadPayload = {
				clickId,
				eventName: identifyEventName,
				customerExternalId: externalId,
			};
			if (email !== undefined) {
				payload.customerEmail = email;
			}
			if (name !== undefined) {
				payload.customerName = name;
			}
			if (avatar !== undefined) {
				payload.customerAvatar = avatar;
			}
			if (metadata) {
				payload.metadata = metadata;
			}
			await postLead(payload);
		} catch {
			// Never throw to the caller.
		}
	}

	async function track(
		eventName: string,
		props?: TrackProperties,
	): Promise<void> {
		try {
			if (!siteKey) {
				missingSiteKey();
				return;
			}
			const clickId = getClickId();
			if (!clickId) {
				missingClickId("track");
				return;
			}
			if (!currentExternalId) {
				missingIdentify();
				return;
			}
			const payload: LeadPayload = {
				clickId,
				eventName,
				customerExternalId: currentExternalId,
			};
			const metadata = props ? omitEmpty(props) : undefined;
			if (metadata) {
				payload.metadata = metadata;
			}
			await postLead(payload);
		} catch {
			// Never throw to the caller.
		}
	}

	function setConsent(granted: boolean): void {
		try {
			canPersist = granted;
			if (granted) {
				if (memoryClickId) {
					persist(memoryClickId);
				}
				if (memoryVisitorId) {
					writeCookie(VISITOR_COOKIE, memoryVisitorId, cookieOptions);
				}
				if (memorySession) {
					writeCookie(
						SESSION_COOKIE,
						JSON.stringify(memorySession),
						cookieOptions,
					);
				}
				return;
			}
			eraseCookie(queryParam, { domain: cookieDomain, path: cookiePath });
			eraseCookie(VISITOR_COOKIE, { domain: cookieDomain, path: cookiePath });
			eraseCookie(SESSION_COOKIE, { domain: cookieDomain, path: cookiePath });
		} catch {
			// Never throw to the caller.
		}
	}

	function reset(): void {
		try {
			memoryClickId = null;
			currentExternalId = null;
			memoryVisitorId = null;
			memorySession = null;
			lastFiredPath = null;
			// Restore the static config/`data-props` defaults, not an empty bag —
			// per-user context set via setProps() is what should go stale here.
			defaultProps = { ...initialProps };
			eraseCookie(queryParam, { domain: cookieDomain, path: cookiePath });
			eraseCookie(VISITOR_COOKIE, { domain: cookieDomain, path: cookiePath });
			eraseCookie(SESSION_COOKIE, { domain: cookieDomain, path: cookiePath });
		} catch {
			// Never throw to the caller.
		}
	}

	function onReady(cb: () => void): void {
		try {
			if (ready) {
				cb();
				return;
			}
			readyQueue.push(cb);
		} catch {
			// Never throw to the caller.
		}
	}

	init();

	return {
		identify,
		track,
		getClickId,
		setConsent,
		reset,
		ready: onReady,
		init,
		pageview,
		getVisitorId: resolveVisitorId,
		setProps,
	};
}
