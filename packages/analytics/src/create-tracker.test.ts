import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTracker as createRealTracker } from "./index";
import type { TrackerConfig } from "./types";

const SITE_KEY = "opa_pub_test";

/**
 * This file predates pageview autocapture and asserts exact `fetchCalls`
 * counts/indices for `/v1/track/collect` (identify/track). Pageview
 * autocapture defaults to `true` and would fire its own `/v1/track/pageview`
 * request on every `createTracker()` call here, throwing those counts off —
 * so every test in this file opts out of it. Pageview/autocapture behavior
 * itself is covered end-to-end in `create-tracker.pageview.test.ts`.
 */
function createTracker(config: TrackerConfig = {}) {
	return createRealTracker({ trackPageviews: false, ...config });
}

type Listener = (event: { type: string; target: unknown }) => void;

type FakeAnchor = {
	href: string;
	closest: (selector: string) => FakeAnchor | null;
};

type BrowserOptions = {
	href?: string;
	persistCookies?: boolean;
};

type Browser = {
	cookieWrites: string[];
	cookieJar: Map<string, string>;
	storage: Map<string, string>;
	anchors: FakeAnchor[];
	beaconCalls: Array<{ url: string; data: unknown }>;
	fetchCalls: Array<{ url: string; body: unknown; init: RequestInit }>;
	visibilityState: DocumentVisibilityState;
	dispatchDocument: (type: string, target?: unknown) => void;
	dispatchWindow: (type: string) => void;
	setHref: (href: string) => void;
	blockCookies: () => void;
};

const originals = {
	document: globalThis.document,
	window: globalThis.window,
	navigator: globalThis.navigator,
	localStorage: globalThis.localStorage,
	fetch: globalThis.fetch,
};

let browser: Browser;

function parseCookieAssignment(raw: string): {
	name: string;
	value: string;
	maxAge: number | null;
} {
	const segments = raw.split(";").map((part) => part.trim());
	const nv = segments[0] ?? "";
	const eq = nv.indexOf("=");
	const name = eq === -1 ? nv : nv.slice(0, eq);
	const value = eq === -1 ? "" : nv.slice(eq + 1);
	let maxAge: number | null = null;
	for (const attr of segments.slice(1)) {
		const [key, val] = attr.split("=");
		if (key?.toLowerCase() === "max-age") {
			maxAge = Number(val);
		}
	}
	return { name, value, maxAge };
}

function installBrowser(options: BrowserOptions = {}): Browser {
	const href = options.href ?? "https://shop.example.com/landing";
	const persistCookies = options.persistCookies ?? true;
	const cookieJar = new Map<string, string>();
	const cookieWrites: string[] = [];
	const storage = new Map<string, string>();
	const anchors: FakeAnchor[] = [];
	const beaconCalls: Array<{ url: string; data: unknown }> = [];
	const fetchCalls: Array<{ url: string; body: unknown; init: RequestInit }> =
		[];
	const documentListeners = new Map<string, Listener[]>();
	const windowListeners = new Map<string, Listener[]>();
	let cookiesBlocked = persistCookies === false;
	let currentHref = href;
	let visibilityState: DocumentVisibilityState = "visible";

	const location = {
		get href() {
			return currentHref;
		},
		get search() {
			return new URL(currentHref).search;
		},
		get hostname() {
			return new URL(currentHref).hostname;
		},
		get protocol() {
			return new URL(currentHref).protocol;
		},
		get pathname() {
			return new URL(currentHref).pathname;
		},
	};

	const localStorage = {
		getItem(key: string) {
			return storage.has(key) ? (storage.get(key) ?? null) : null;
		},
		setItem(key: string, value: string) {
			storage.set(key, String(value));
		},
		removeItem(key: string) {
			storage.delete(key);
		},
		clear() {
			storage.clear();
		},
		key(index: number) {
			return [...storage.keys()][index] ?? null;
		},
		get length() {
			return storage.size;
		},
	};

	function addListener(
		bag: Map<string, Listener[]>,
		type: string,
		cb: Listener,
	) {
		const list = bag.get(type) ?? [];
		list.push(cb);
		bag.set(type, list);
	}

	function dispatch(
		bag: Map<string, Listener[]>,
		type: string,
		target: unknown = null,
	) {
		const event = { type, target };
		for (const cb of bag.get(type) ?? []) {
			cb(event);
		}
	}

	const document = {
		get cookie() {
			return [...cookieJar.entries()]
				.map(([name, value]) => `${name}=${value}`)
				.join("; ");
		},
		set cookie(raw: string) {
			cookieWrites.push(raw);
			if (cookiesBlocked) {
				return;
			}
			const parsed = parseCookieAssignment(raw);
			if (parsed.maxAge === 0) {
				cookieJar.delete(parsed.name);
				return;
			}
			cookieJar.set(parsed.name, parsed.value);
		},
		get visibilityState() {
			return visibilityState;
		},
		addEventListener(type: string, cb: Listener) {
			addListener(documentListeners, type, cb);
		},
		querySelectorAll(selector: string) {
			if (selector === "a[href]" || selector === "a") {
				return anchors;
			}
			return [];
		},
	};

	const window = {
		location,
		localStorage,
		addEventListener(type: string, cb: Listener) {
			addListener(windowListeners, type, cb);
		},
	};

	const navigator = {
		sendBeacon(url: string, data?: unknown) {
			beaconCalls.push({ url, data });
			return true;
		},
	};

	const fetchMock = mock(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			let body: unknown = null;
			if (typeof init?.body === "string") {
				body = JSON.parse(init.body);
			}
			fetchCalls.push({ url, body, init: init ?? {} });
			return new Response("{}", {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	);

	Object.defineProperty(globalThis, "document", {
		value: document,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(globalThis, "window", {
		value: window,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(globalThis, "navigator", {
		value: navigator,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(globalThis, "localStorage", {
		value: localStorage,
		configurable: true,
		writable: true,
	});
	globalThis.fetch = fetchMock as unknown as typeof fetch;

	browser = {
		cookieWrites,
		cookieJar,
		storage,
		anchors,
		beaconCalls,
		fetchCalls,
		get visibilityState() {
			return visibilityState;
		},
		set visibilityState(value: DocumentVisibilityState) {
			visibilityState = value;
		},
		dispatchDocument: (type, target) =>
			dispatch(documentListeners, type, target),
		dispatchWindow: (type) => dispatch(windowListeners, type),
		setHref: (next) => {
			currentHref = next;
		},
		blockCookies: () => {
			cookiesBlocked = true;
			cookieJar.clear();
		},
	};
	return browser;
}

function uninstallBrowser() {
	const assign = (key: keyof typeof originals, value: unknown) => {
		if (value === undefined) {
			try {
				delete (globalThis as Record<string, unknown>)[key];
			} catch {
				Object.defineProperty(globalThis, key, {
					value: undefined,
					configurable: true,
					writable: true,
				});
			}
			return;
		}
		Object.defineProperty(globalThis, key, {
			value,
			configurable: true,
			writable: true,
		});
	};
	assign("document", originals.document);
	assign("window", originals.window);
	assign("navigator", originals.navigator);
	assign("localStorage", originals.localStorage);
	globalThis.fetch = originals.fetch;
}

function cookieValue(name: string): string | null {
	return browser.cookieJar.get(name) ?? null;
}

function stripDocument() {
	uninstallBrowser();
	for (const key of [
		"document",
		"window",
		"navigator",
		"localStorage",
	] as const) {
		try {
			delete (globalThis as Record<string, unknown>)[key];
		} catch {
			Object.defineProperty(globalThis, key, {
				value: undefined,
				configurable: true,
				writable: true,
			});
		}
	}
}

beforeEach(() => {
	installBrowser();
});

afterEach(() => {
	uninstallBrowser();
});

describe("createTracker init / cookie capture", () => {
	test("captures opa_id from the URL and writes a first-party cookie", () => {
		installBrowser({
			href: "https://shop.example.com/landing?opa_id=click_abc&utm_source=x",
		});
		const tracker = createTracker();
		expect(tracker.getClickId()).toBe("click_abc");
		expect(cookieValue("opa_id")).toBe("click_abc");
		const write = browser.cookieWrites[0] ?? "";
		expect(write.startsWith("opa_id=click_abc")).toBe(true);
		expect(write).toContain("SameSite=Lax");
		expect(write).toContain("Path=/");
		expect(write).toContain("Max-Age=7776000");
		expect(write).toContain("Secure");
	});

	test("last-click overwrites an existing cookie with the new URL value", () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=second" });
		browser.cookieJar.set("opa_id", "first");
		const tracker = createTracker({ attributionModel: "last-click" });
		expect(tracker.getClickId()).toBe("second");
		expect(cookieValue("opa_id")).toBe("second");
	});

	test("last-click is the default attribution model", () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=second" });
		browser.cookieJar.set("opa_id", "first");
		const tracker = createTracker();
		expect(tracker.getClickId()).toBe("second");
	});

	test("first-click preserves an existing cookie when a new opa_id arrives", () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=second" });
		browser.cookieJar.set("opa_id", "first");
		const tracker = createTracker({ attributionModel: "first-click" });
		expect(tracker.getClickId()).toBe("first");
		expect(cookieValue("opa_id")).toBe("first");
		expect(browser.cookieWrites).toHaveLength(0);
	});

	test("first-click writes the URL value when no cookie exists yet", () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=first" });
		const tracker = createTracker({ attributionModel: "first-click" });
		expect(tracker.getClickId()).toBe("first");
		expect(cookieValue("opa_id")).toBe("first");
	});

	test("getClickId reads a cookie captured on a previous visit (no URL param)", () => {
		installBrowser({ href: "https://shop.example.com/pricing" });
		browser.cookieJar.set("opa_id", "stored");
		const tracker = createTracker();
		expect(tracker.getClickId()).toBe("stored");
	});

	test("custom queryParam names the cookie and the URL key", () => {
		installBrowser({ href: "https://shop.example.com/?ref=xyz" });
		const tracker = createTracker({ queryParam: "ref" });
		expect(tracker.getClickId()).toBe("xyz");
		expect(cookieValue("ref")).toBe("xyz");
		expect(cookieValue("opa_id")).toBeNull();
	});
});

describe("consent mode", () => {
	test("consent 'denied' blocks ids and does not write cookies", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=pending" });
		const tracker = createTracker({ key: SITE_KEY, consent: "denied" });
		expect(tracker.getClickId()).toBeNull();
		expect(tracker.getVisitorId()).toBeNull();
		expect(cookieValue("opa_id")).toBeNull();
		expect(cookieValue("opa_vid")).toBeNull();
		expect(browser.cookieWrites).toHaveLength(3);
		expect(
			browser.cookieWrites.every((write) => write.includes("Max-Age=0")),
		).toBe(true);
		await tracker.identify({ externalId: "cus_1" });
		await tracker.track("Signup");
		expect(browser.fetchCalls).toHaveLength(0);
	});

	test("setConsent(true) allows fresh capture from the current page", () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=pending" });
		const tracker = createTracker({ consent: "denied" });
		expect(tracker.getClickId()).toBeNull();
		tracker.setConsent(true);
		const visitorId = tracker.getVisitorId();
		expect(visitorId).toBeTruthy();
		expect(cookieValue("opa_vid")).toBe(visitorId);
		expect(tracker.getClickId()).toBe("pending");
		expect(cookieValue("opa_id")).toBe("pending");
	});

	test("setConsent(false) erases analytics cookies and blocks manual calls/getters", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const tracker = createTracker({ key: SITE_KEY });
		const visitorId = tracker.getVisitorId();
		expect(cookieValue("opa_id")).toBe("click_abc");
		expect(cookieValue("opa_vid")).toBe(visitorId);
		tracker.setConsent(false);
		expect(cookieValue("opa_id")).toBeNull();
		expect(cookieValue("opa_vid")).toBeNull();
		expect(cookieValue("opa_sid")).toBeNull();
		expect(tracker.getClickId()).toBeNull();
		expect(tracker.getVisitorId()).toBeNull();
		await tracker.identify({ externalId: "cus_1" });
		await tracker.track("Signup");
		expect(browser.fetchCalls).toHaveLength(0);
	});
});

describe("opa_ignore opt-out", () => {
	test("is an absolute kill switch for init, manual calls, getters, and decoration", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		browser.storage.set("opa_ignore", "true");
		browser.cookieJar.set("opa_id", "stored-click");
		browser.cookieJar.set("opa_vid", "stored-visitor");
		browser.cookieJar.set("opa_sid", "stored-session");
		const outbound: FakeAnchor = {
			href: "https://checkout.example.com/pay",
			closest(selector) {
				return selector.startsWith("a") ? outbound : null;
			},
		};
		browser.anchors.push(outbound);
		const tracker = createTracker({
			key: SITE_KEY,
			outboundDomains: ["checkout.example.com"],
		});
		expect(tracker.getClickId()).toBeNull();
		expect(tracker.getVisitorId()).toBeNull();
		await tracker.identify({ externalId: "cus_1" });
		await tracker.track("Signup");
		browser.dispatchDocument("click", outbound);
		expect(browser.fetchCalls).toHaveLength(0);
		expect(outbound.href).toBe("https://checkout.example.com/pay");
		expect(cookieValue("opa_id")).toBeNull();
		expect(cookieValue("opa_vid")).toBeNull();
		expect(cookieValue("opa_sid")).toBeNull();
	});

	test("clears existing analytics state when opa_ignore is enabled after init", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const tracker = createTracker({ key: SITE_KEY });
		const anonymousId = tracker.getVisitorId();
		expect(anonymousId).toBeTruthy();
		expect(tracker.getClickId()).toBe("click_abc");
		expect(cookieValue("opa_id")).toBe("click_abc");
		expect(cookieValue("opa_vid")).toBe(anonymousId);

		browser.storage.set("opa_ignore", "true");
		await tracker.track("Signup");

		expect(browser.fetchCalls).toHaveLength(0);
		expect(tracker.getClickId()).toBeNull();
		expect(tracker.getVisitorId()).toBeNull();
		expect(cookieValue("opa_id")).toBeNull();
		expect(cookieValue("opa_vid")).toBeNull();
		expect(cookieValue("opa_sid")).toBeNull();
	});
});

describe("identify and track", () => {
	test("identify POSTs the exact payload to /v1/track/identify with the site-key header", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const tracker = createTracker({ key: SITE_KEY });
		const anonymousId = tracker.getVisitorId();
		await tracker.identify({
			externalId: "cus_1",
			email: "ada@example.com",
			name: "Ada",
			avatar: "https://cdn.example.com/ada.png",
			plan: "pro",
		});
		expect(browser.fetchCalls).toHaveLength(1);
		const call = browser.fetchCalls[0];
		expect(call?.url).toBe("https://api.opa.sh/v1/track/identify");
		expect(call?.init.method).toBe("POST");
		expect(call?.init.headers).toEqual({
			"content-type": "application/json",
			"x-opa-site-key": SITE_KEY,
		});
		expect(call?.body).toEqual({
			anonymousId,
			externalId: "cus_1",
			clickId: "click_abc",
			traits: {
				email: "ada@example.com",
				name: "Ada",
				avatar: "https://cdn.example.com/ada.png",
				plan: "pro",
			},
		});
	});

	test("identify accepts a custom apiHost and does not require click attribution", async () => {
		installBrowser({ href: "https://shop.example.com/" });
		const tracker = createTracker({
			key: SITE_KEY,
			apiHost: "https://api.example.test/",
		});
		const anonymousId = tracker.getVisitorId();
		await tracker.identify({ externalId: "cus_1" });
		expect(browser.fetchCalls[0]?.url).toBe(
			"https://api.example.test/v1/track/identify",
		);
		expect(browser.fetchCalls[0]?.body).toEqual({
			anonymousId,
			externalId: "cus_1",
		});
	});

	test("track uses the externalId from the last identify", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const tracker = createTracker({ key: SITE_KEY });
		const anonymousId = tracker.getVisitorId();
		await tracker.identify({ externalId: "cus_1" });
		await tracker.track("Trial started", { plan: "start", seats: 3 });
		expect(browser.fetchCalls).toHaveLength(2);
		expect(browser.fetchCalls[1]?.url).toBe(
			"https://api.opa.sh/v1/track/event",
		);
		expect(browser.fetchCalls[1]?.init.headers).toEqual({
			"content-type": "application/json",
			"x-opa-site-key": SITE_KEY,
		});
		const body = browser.fetchCalls[1]?.body as Record<string, unknown>;
		expect(body.eventId).toEqual(expect.any(String));
		expect(body).toEqual({
			eventId: body.eventId,
			anonymousId,
			clickId: "click_abc",
			eventName: "Trial started",
			externalId: "cus_1",
			properties: { plan: "start", seats: 3 },
		});
	});

	test("a later identify replaces the externalId used by track", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const tracker = createTracker({ key: SITE_KEY });
		await tracker.identify({ externalId: "cus_1" });
		await tracker.identify({ externalId: "cus_2" });
		await tracker.track("Purchase");
		const body = browser.fetchCalls[2]?.body as Record<string, unknown>;
		expect(body.externalId).toBe("cus_2");
		expect(body.eventName).toBe("Purchase");
	});

	test("track before identify and before click attribution still sends an anonymous event", async () => {
		installBrowser({ href: "https://shop.example.com/" });
		const tracker = createTracker({ key: SITE_KEY });
		const anonymousId = tracker.getVisitorId();
		await tracker.track("Signup", { plan: "free" });
		expect(browser.fetchCalls).toHaveLength(1);
		const body = browser.fetchCalls[0]?.body as Record<string, unknown>;
		expect(browser.fetchCalls[0]?.url).toBe(
			"https://api.opa.sh/v1/track/event",
		);
		expect(body.eventId).toEqual(expect.any(String));
		expect(body).toEqual({
			eventId: body.eventId,
			anonymousId,
			eventName: "Signup",
			properties: { plan: "free" },
		});
	});

	test("identify and track without a site-key are no-ops and warn in dev", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const warnings: unknown[][] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args);
		};
		try {
			const tracker = createTracker();
			await tracker.identify({ externalId: "cus_1" });
			await tracker.track("Signup");
			expect(browser.fetchCalls).toHaveLength(0);
			expect(warnings.length).toBeGreaterThanOrEqual(2);
			expect(String(warnings[0]?.[0])).toContain("sem site-key");
			expect(String(warnings[1]?.[0])).toContain("sem site-key");
		} finally {
			console.warn = originalWarn;
		}
	});

	test("a blank site-key is treated as missing", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const originalWarn = console.warn;
		console.warn = () => {};
		try {
			const tracker = createTracker({ key: "   " });
			await tracker.identify({ externalId: "cus_1" });
			expect(browser.fetchCalls).toHaveLength(0);
		} finally {
			console.warn = originalWarn;
		}
	});

	test("track without a click id sends and does not throw", async () => {
		installBrowser({ href: "https://shop.example.com/" });
		const originalWarn = console.warn;
		console.warn = () => {};
		try {
			const tracker = createTracker({ key: SITE_KEY });
			await expect(tracker.track("Signup")).resolves.toBeUndefined();
			expect(browser.fetchCalls).toHaveLength(1);
			const body = browser.fetchCalls[0]?.body as Record<string, unknown>;
			expect(body.clickId).toBeUndefined();
		} finally {
			console.warn = originalWarn;
		}
	});

	test("a network error retries once and never rejects the caller", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		let attempts = 0;
		globalThis.fetch = mock(async () => {
			attempts += 1;
			if (attempts === 1) {
				throw new TypeError("Failed to fetch");
			}
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;
		const tracker = createTracker({ key: SITE_KEY });
		await tracker.identify({ externalId: "cus_1" });
		await expect(tracker.track("Signup")).resolves.toBeUndefined();
		expect(attempts).toBe(3);
	});

	test("a persistent network error is swallowed", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		globalThis.fetch = mock(async () => {
			throw new TypeError("Failed to fetch");
		}) as unknown as typeof fetch;
		const tracker = createTracker({ key: SITE_KEY });
		await expect(
			tracker.identify({ externalId: "cus_1" }),
		).resolves.toBeUndefined();
	});
});

describe("reset, ready, outbound, unload", () => {
	test("reset clears attribution, anonymous identity, session, and external id", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const tracker = createTracker({ key: SITE_KEY });
		const firstAnonymousId = tracker.getVisitorId();
		expect(tracker.getClickId()).toBe("click_abc");
		await tracker.identify({ externalId: "cus_1" });
		tracker.reset();
		expect(tracker.getClickId()).toBeNull();
		expect(cookieValue("opa_id")).toBeNull();
		expect(cookieValue("opa_vid")).toBeNull();
		expect(cookieValue("opa_sid")).toBeNull();
		await tracker.track("Signup");
		const eventBody = browser.fetchCalls[1]?.body as Record<string, unknown>;
		expect(eventBody.externalId).toBeUndefined();
		expect(eventBody.clickId).toBeUndefined();
		expect(eventBody.anonymousId).not.toBe(firstAnonymousId);
	});

	test("resetIdentity rotates anonymous identity without clearing click attribution", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const tracker = createTracker({ key: SITE_KEY });
		const first = tracker.getVisitorId();
		tracker.resetIdentity();
		const second = tracker.getVisitorId();
		expect(second).not.toBe(first);
		expect(tracker.getClickId()).toBe("click_abc");
		expect(cookieValue("opa_id")).toBe("click_abc");
		expect(cookieValue("opa_vid")).toBe(second);
	});

	test("resetIdentity can clear stored external id without rotating anonymous identity", async () => {
		const tracker = createTracker({ key: SITE_KEY });
		const anonymousId = tracker.getVisitorId();
		await tracker.identify({ externalId: "cus_1" });
		tracker.resetIdentity({ rotateAnonymous: false });
		await tracker.track("Signup");
		const body = browser.fetchCalls[1]?.body as Record<string, unknown>;
		expect(body.anonymousId).toBe(anonymousId);
		expect(body.externalId).toBeUndefined();
	});

	test("resetAttribution clears only click attribution", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const tracker = createTracker({ key: SITE_KEY });
		const anonymousId = tracker.getVisitorId();
		await tracker.identify({ externalId: "cus_1" });
		tracker.resetAttribution();
		expect(tracker.getClickId()).toBeNull();
		expect(cookieValue("opa_id")).toBeNull();
		await tracker.track("Signup");
		const body = browser.fetchCalls[1]?.body as Record<string, unknown>;
		expect(body.anonymousId).toBe(anonymousId);
		expect(body.externalId).toBe("cus_1");
		expect(body.clickId).toBeUndefined();
	});

	test("ready fires after init (synchronously when document is present)", () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const tracker = createTracker();
		let called = false;
		tracker.ready(() => {
			called = true;
		});
		expect(called).toBe(true);
	});

	test("decorates outbound anchors with opa_id and is idempotent", () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const outbound: FakeAnchor = {
			href: "https://checkout.example.com/pay",
			closest(selector) {
				return selector.startsWith("a") ? outbound : null;
			},
		};
		const already: FakeAnchor = {
			href: "https://checkout.example.com/pay?opa_id=preexisting",
			closest(selector) {
				return selector.startsWith("a") ? already : null;
			},
		};
		const internal: FakeAnchor = {
			href: "https://shop.example.com/about",
			closest(selector) {
				return selector.startsWith("a") ? internal : null;
			},
		};
		browser.anchors.push(outbound, already, internal);
		createTracker({ outboundDomains: ["checkout.example.com"] });
		expect(outbound.href).toBe(
			"https://checkout.example.com/pay?opa_id=click_abc",
		);
		expect(already.href).toBe(
			"https://checkout.example.com/pay?opa_id=preexisting",
		);
		expect(internal.href).toBe("https://shop.example.com/about");
	});

	test("uses fetch keepalive on the pagehide unload path for in-flight events", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const calls: Array<{ url: string; init: RequestInit }> = [];
		let hang = false;
		globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(input), init: init ?? {} });
			if (hang) {
				return new Promise<Response>(() => {
					// hang so the payload stays in-flight until unload
				});
			}
			return Promise.resolve(new Response("{}", { status: 200 }));
		}) as unknown as typeof fetch;
		const tracker = createTracker({ key: SITE_KEY });
		await tracker.identify({ externalId: "cus_1" });
		hang = true;
		void tracker.track("Signup", { source: "cta" });
		await Promise.resolve();
		browser.dispatchWindow("pagehide");
		expect(browser.beaconCalls).toHaveLength(0);
		const flush = calls.filter((call) => call.init.keepalive === true);
		expect(flush.length).toBeGreaterThan(0);
		const last = flush[flush.length - 1];
		expect(last?.url).toBe("https://api.opa.sh/v1/track/event");
		expect(last?.init.headers).toEqual({
			"content-type": "application/json",
			"x-opa-site-key": SITE_KEY,
		});
		expect(JSON.parse(String(last?.init.body))).toEqual({
			eventId: expect.any(String),
			anonymousId: expect.any(String),
			clickId: "click_abc",
			eventName: "Signup",
			externalId: "cus_1",
			properties: { source: "cta" },
		});
	});

	test("opa_ignore clears in-flight unload flushes without cancelling the already-started send", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const calls: Array<{ url: string; init: RequestInit }> = [];
		globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(input), init: init ?? {} });
			return new Promise<Response>(() => {
				// Keep identify in-flight so pagehide would flush it if not cleared.
			});
		}) as unknown as typeof fetch;
		const tracker = createTracker({ key: SITE_KEY });
		void tracker.identify({ externalId: "cus_1" });
		await Promise.resolve();
		expect(calls).toHaveLength(1);

		browser.storage.set("opa_ignore", "true");
		expect(tracker.getClickId()).toBeNull();
		browser.dispatchWindow("pagehide");

		expect(calls).toHaveLength(1);
		expect(browser.beaconCalls).toHaveLength(0);
	});

	test("setConsent(false) clears in-flight unload flushes without cancelling the already-started send", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		const calls: Array<{ url: string; init: RequestInit }> = [];
		globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(input), init: init ?? {} });
			return new Promise<Response>(() => {
				// Keep event in-flight so pagehide would flush it if not cleared.
			});
		}) as unknown as typeof fetch;
		const tracker = createTracker({ key: SITE_KEY });
		void tracker.track("Signup", { source: "cta" });
		await Promise.resolve();
		expect(calls).toHaveLength(1);

		tracker.setConsent(false);
		browser.dispatchWindow("pagehide");

		expect(calls).toHaveLength(1);
		expect(browser.beaconCalls).toHaveLength(0);
	});

	test("uses fetch keepalive when the document is already hidden", async () => {
		installBrowser({ href: "https://shop.example.com/?opa_id=click_abc" });
		browser.visibilityState = "hidden";
		const tracker = createTracker({ key: SITE_KEY });
		await tracker.identify({ externalId: "cus_1" });
		expect(browser.beaconCalls).toHaveLength(0);
		expect(browser.fetchCalls).toHaveLength(1);
		expect(browser.fetchCalls[0]?.url).toBe(
			"https://api.opa.sh/v1/track/identify",
		);
		expect(browser.fetchCalls[0]?.init.keepalive).toBe(true);
		expect(browser.fetchCalls[0]?.init.headers).toEqual({
			"content-type": "application/json",
			"x-opa-site-key": SITE_KEY,
		});
		expect(browser.fetchCalls[0]?.body).toEqual({
			anonymousId: expect.any(String),
			clickId: "click_abc",
			externalId: "cus_1",
		});
	});
});

describe("SSR / edge", () => {
	test("createTracker is a no-op without document and never throws", async () => {
		stripDocument();
		expect(() => createTracker()).not.toThrow();
		const tracker = createTracker();
		expect(tracker.getClickId()).toBeNull();
		await expect(
			tracker.identify({ externalId: "cus_1" }),
		).resolves.toBeUndefined();
		await expect(tracker.track("Signup")).resolves.toBeUndefined();
		expect(() => tracker.setConsent(true)).not.toThrow();
		expect(() => tracker.reset()).not.toThrow();
		expect(() => tracker.init()).not.toThrow();
		let readyCalled = false;
		tracker.ready(() => {
			readyCalled = true;
		});
		expect(readyCalled).toBe(true);
	});
});

describe("localStorage fallback", () => {
	test("falls back to localStorage when document.cookie does not stick", () => {
		installBrowser({
			href: "https://shop.example.com/?opa_id=click_ls",
			persistCookies: false,
		});
		const tracker = createTracker();
		expect(tracker.getClickId()).toBe("click_ls");
		expect(cookieValue("opa_id")).toBeNull();
		expect(browser.storage.get("opa_id")).toBe("click_ls");

		installBrowser({ href: "https://shop.example.com/next" });
		browser.storage.set("opa_id", "click_ls");
		browser.blockCookies();
		const next = createTracker();
		expect(next.getClickId()).toBe("click_ls");
	});
});
