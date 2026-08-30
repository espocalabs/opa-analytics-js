export type AttributionModel = "last-click" | "first-click";

export type ConsentMode = "default" | "denied";

export type TrackerCookieConfig = {
	domain?: string;
	expiresInDays?: number;
	path?: string;
};

export type TrackerConfig = {
	apiHost?: string;
	/** Public site-key (`opa_pub_...`). Required to POST to `/v1/track/collect`. */
	key?: string;
	cookie?: TrackerCookieConfig;
	attributionModel?: AttributionModel;
	outboundDomains?: string[];
	consent?: ConsentMode;
	queryParam?: string;
	identifyEventName?: string;
	/** Automatic pageview capture (initial load + SPA navigation). Default `true`. */
	trackPageviews?: boolean;
	/** Also treat `hashchange` as a route change (hash-based routers). Default `false`. */
	hashRouting?: boolean;
	/** Capture pageviews on `localhost`/`127.0.0.1`/`file:` pages too. Default `false`. */
	captureLocalhost?: boolean;
	/** Default `props` merged onto every pageview (manual + autocaptured).
	 * Also settable/updatable at runtime via `tracker.setProps()`. */
	props?: Record<string, unknown>;
	/** Declarative `data-opa-event` click tracking (sugar over `track()`).
	 * Default `true` — safe on by default since it only ever fires on
	 * elements explicitly tagged with `data-opa-event`. */
	trackClicks?: boolean;
};

export type IdentifyInput = {
	externalId: string;
	email?: string;
	name?: string;
	avatar?: string;
	[key: string]: unknown;
};

export type TrackProperties = Record<string, unknown>;

export type LeadPayload = {
	clickId: string;
	eventName: string;
	customerExternalId: string;
	customerEmail?: string;
	customerName?: string;
	customerAvatar?: string;
	metadata?: Record<string, unknown>;
};

export type IdentifyPayload = {
	anonymousId: string;
	externalId: string;
	clickId?: string;
	email?: string;
	name?: string;
	avatar?: string;
	traits?: Record<string, unknown>;
};

export type EventPayload = {
	eventId: string;
	anonymousId: string;
	eventName: string;
	clickId?: string;
	externalId?: string;
	properties?: Record<string, unknown>;
};

/**
 * Client-collectable fields sent to `POST /v1/track/pageview`. The server
 * derives geo/user-agent/bot classification from the request itself — never
 * send raw IP or UA strings from the client.
 */
export type PageviewPayload = {
	event: "pageview";
	siteKey?: string;
	/** Anonymous, cookie-persisted visitor id (`opa_vid`). Stitches pageviews
	 * from the same browser together — never PII. */
	anonId: string;
	/** Rotates after 30min inactivity or when the UTM set changes. */
	sessionId: string;
	clickId?: string;
	url: string;
	pathname: string;
	host: string;
	referrer: string;
	title?: string;
	screenW: number;
	screenH: number;
	viewportW: number;
	viewportH: number;
	dpr: number;
	language: string;
	timezone: string;
	timezoneOffset: number;
	utmSource?: string;
	utmMedium?: string;
	utmCampaign?: string;
	utmTerm?: string;
	utmContent?: string;
	fbclid?: string;
	gclid?: string;
	ttclid?: string;
	msclkid?: string;
	gadSource?: string;
	wbraid?: string;
	gbraid?: string;
	kwaiClickId?: string;
	/** JSON string of long-tail click ids (li_fat_id, mc_cid, igshid, twclid,
	 * dclid, gclsrc) — kept out of the top-level shape so adding more never
	 * requires a payload/schema migration. */
	clickIdsRaw?: string;
	dnt?: string | null;
	gpc?: boolean;
	consentState: ConsentMode;
	ts: number;
	/** Free-form metadata bag (server caps it at 8KB) — the default `props`
	 * set via config/`data-props`/`setProps()`, merged with any per-call
	 * `pageview({ props })` override. Omitted entirely when empty. */
	props?: Record<string, unknown>;
};

/** Fields a caller may override on a manual `pageview()` call — everything
 * else (ids, device/locale, UTMs, consent) is always collected fresh.
 * `props` is MERGED over the tracker's default props (per-key override),
 * not a replacement of them. */
export type PageviewOverrides = Partial<
	Pick<
		PageviewPayload,
		"url" | "pathname" | "host" | "referrer" | "title" | "props"
	>
>;

export type Tracker = {
	identify: (input: IdentifyInput) => Promise<void>;
	track: (eventName: string, props?: TrackProperties) => Promise<void>;
	getClickId: () => string | null;
	setConsent: (granted: boolean) => void;
	reset: () => void;
	resetIdentity: (options?: { rotateAnonymous?: boolean }) => void;
	resetAttribution: () => void;
	ready: (cb: () => void) => void;
	init: () => void;
	/** Sends one pageview now. Autocapture calls this internally on initial
	 * load and SPA navigation; call it directly for manual/SPA-framework
	 * integrations (e.g. `@opa.sh/analytics/next`). Never requires `clickId`
	 * or a prior `identify()` — only the site key. */
	pageview: (overrides?: PageviewOverrides) => Promise<void>;
	/** The anonymous visitor id (`opa_vid`), generating and persisting one on
	 * first access if consent allows. `null` outside a browser. */
	getVisitorId: () => string | null;
	/** Merges `props` into the default props bag sent with every subsequent
	 * pageview (manual and autocaptured). Instance-scoped — does not affect
	 * other tracker instances. `reset()` restores the config/`data-props`
	 * defaults this tracker was created with. */
	setProps: (props: Record<string, unknown>) => void;
};
