import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	createTracker,
	resetPageviewAutocaptureForTests,
} from "./create-tracker";

const SITE_KEY = "opa_pub_test";

type Listener = () => void;

type Browser = {
	fetchCalls: Array<{ url: string; body: unknown; init: RequestInit }>;
	visibilityState: DocumentVisibilityState;
	dispatchDocument: (type: string) => void;
	dispatchWindow: (type: string) => void;
	pushState: (...args: unknown[]) => void;
	setPath: (pathname: string, search?: string, hash?: string) => void;
	storage: Map<string, string>;
	cookieJar: Map<string, string>;
};

const originals = {
	document: globalThis.document,
	window: globalThis.window,
	navigator: globalThis.navigator,
	localStorage: globalThis.localStorage,
	fetch: globalThis.fetch,
};

let browser: Browser;

type BrowserOptions = {
	href?: string;
	visibilityState?: DocumentVisibilityState;
	webdriver?: boolean;
};

function installBrowser(options: BrowserOptions = {}): Browser {
	let currentHref = options.href ?? "https://shop.example.com/landing";
	let visibilityState: DocumentVisibilityState =
		options.visibilityState ?? "visible";
	const storage = new Map<string, string>();
	const cookieJar = new Map<string, string>();
	const documentListeners = new Map<string, Listener[]>();
	const windowListeners = new Map<string, Listener[]>();
	const fetchCalls: Array<{ url: string; body: unknown; init: RequestInit }> =
		[];

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
		get host() {
			return new URL(currentHref).host;
		},
		get protocol() {
			return new URL(currentHref).protocol;
		},
		get pathname() {
			return new URL(currentHref).pathname;
		},
		get hash() {
			return new URL(currentHref).hash;
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

	function dispatch(bag: Map<string, Listener[]>, type: string) {
		for (const cb of bag.get(type) ?? []) {
			cb();
		}
	}

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

	const document = {
		get cookie() {
			return [...cookieJar.entries()]
				.map(([name, value]) => `${name}=${value}`)
				.join("; ");
		},
		set cookie(raw: string) {
			const [nv, ...attrs] = raw.split(";").map((part) => part.trim());
			const eq = (nv ?? "").indexOf("=");
			const name = eq === -1 ? (nv ?? "") : (nv ?? "").slice(0, eq);
			const value = eq === -1 ? "" : (nv ?? "").slice(eq + 1);
			const maxAge = attrs.find((attr) =>
				attr.toLowerCase().startsWith("max-age="),
			);
			if (maxAge && Number(maxAge.slice("max-age=".length)) === 0) {
				cookieJar.delete(name);
				return;
			}
			cookieJar.set(name, value);
		},
		get visibilityState() {
			return visibilityState;
		},
		referrer: "",
		title: "Landing",
		addEventListener(type: string, cb: Listener) {
			addListener(documentListeners, type, cb);
		},
		removeEventListener(type: string, cb: Listener) {
			const list = documentListeners.get(type) ?? [];
			documentListeners.set(
				type,
				list.filter((entry) => entry !== cb),
			);
		},
		querySelectorAll() {
			return [];
		},
	};

	function pushState(..._args: unknown[]) {
		// The tracker's history patch wraps this; nothing to actually do for a
		// fake history object beyond letting the wrapper's side effects run.
	}

	const history = {
		pushState,
	};

	const window = {
		location,
		localStorage,
		history,
		screen: { width: 1920, height: 1080 },
		innerWidth: 1280,
		innerHeight: 800,
		devicePixelRatio: 2,
		addEventListener(type: string, cb: Listener) {
			addListener(windowListeners, type, cb);
		},
		removeEventListener(type: string, cb: Listener) {
			const list = windowListeners.get(type) ?? [];
			windowListeners.set(
				type,
				list.filter((entry) => entry !== cb),
			);
		},
	};

	const navigator = {
		language: "en-US",
		webdriver: options.webdriver ?? false,
		sendBeacon() {
			return true;
		},
	};

	const fetchMock = mock(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			let body: unknown = null;
			if (typeof init?.body === "string") {
				try {
					body = JSON.parse(init.body);
				} catch {
					body = init.body;
				}
			}
			fetchCalls.push({ url, body, init: init ?? {} });
			return new Response("", { status: 202 });
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
		fetchCalls,
		get visibilityState() {
			return visibilityState;
		},
		set visibilityState(value: DocumentVisibilityState) {
			visibilityState = value;
		},
		dispatchDocument: (type) => dispatch(documentListeners, type),
		dispatchWindow: (type) => dispatch(windowListeners, type),
		pushState: (...args) => {
			window.history.pushState(...args);
			dispatch(windowListeners, "__pushStateCalled__");
		},
		setPath: (pathname, search = "", hash = "") => {
			currentHref = `https://shop.example.com${pathname}${search}${hash}`;
		},
		storage,
		cookieJar,
	};
	return browser;
}

function uninstallBrowser() {
	const assign = (key: keyof typeof originals, value: unknown) => {
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

beforeEach(() => {
	installBrowser();
});

afterEach(() => {
	uninstallBrowser();
	resetPageviewAutocaptureForTests();
});

function pageviewCalls() {
	return browser.fetchCalls.filter((c) => c.url.includes("/v1/track/pageview"));
}

async function flush(ms = 0): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("initial pageview", () => {
	test("fires automatically on init when the document is visible", async () => {
		createTracker({ key: SITE_KEY });
		await flush();
		expect(pageviewCalls()).toHaveLength(1);
		const call = pageviewCalls()[0];
		expect(call?.url).toBe("https://api.opa.sh/v1/track/pageview");
		expect(call?.init.headers).toMatchObject({
			"x-opa-site-key": SITE_KEY,
			"content-type": "text/plain",
		});
		const body = call?.body as Record<string, unknown>;
		expect(body.event).toBe("pageview");
		expect(body.pathname).toBe("/landing");
		expect(body.siteKey).toBe(SITE_KEY);
		expect(typeof body.anonId).toBe("string");
		expect(typeof body.sessionId).toBe("string");
	});

	test("defers the initial pageview until the document becomes visible", async () => {
		installBrowser({ visibilityState: "hidden" });
		createTracker({ key: SITE_KEY });
		await flush();
		expect(pageviewCalls()).toHaveLength(0);

		browser.visibilityState = "visible";
		browser.dispatchDocument("visibilitychange");
		await flush();
		expect(pageviewCalls()).toHaveLength(1);
	});

	test("does not fire when trackPageviews is disabled", async () => {
		createTracker({ key: SITE_KEY, trackPageviews: false });
		await flush();
		expect(pageviewCalls()).toHaveLength(0);
	});

	test("warns and skips when there is no site key", async () => {
		const originalWarn = console.warn;
		console.warn = () => {};
		try {
			createTracker();
			await flush();
			expect(pageviewCalls()).toHaveLength(0);
		} finally {
			console.warn = originalWarn;
		}
	});
});

describe("SPA navigation autocapture", () => {
	test("a pushState navigation to a new pathname fires a pageview after the coalesce window", async () => {
		createTracker({ key: SITE_KEY });
		await flush();
		expect(pageviewCalls()).toHaveLength(1); // initial

		browser.setPath("/pricing");
		browser.pushState({}, "", "/pricing");
		await flush(1100);

		expect(pageviewCalls()).toHaveLength(2);
		const body = pageviewCalls()[1]?.body as Record<string, unknown>;
		expect(body.pathname).toBe("/pricing");
	});

	test("a popstate navigation to a new pathname also fires a pageview", async () => {
		createTracker({ key: SITE_KEY });
		await flush();

		browser.setPath("/about");
		browser.dispatchWindow("popstate");
		await flush(1100);

		expect(pageviewCalls()).toHaveLength(2);
	});

	test("dedups a navigation trigger that lands on the same pathname", async () => {
		createTracker({ key: SITE_KEY });
		await flush();

		// pathname unchanged — same-page pushState (e.g. a query-only update)
		browser.pushState({}, "", "/landing");
		await flush(1100);

		expect(pageviewCalls()).toHaveLength(1);
	});

	test("coalesces a rapid pushState + popstate burst into a single pageview", async () => {
		createTracker({ key: SITE_KEY });
		await flush();

		browser.setPath("/a");
		browser.pushState({}, "", "/a");
		browser.dispatchWindow("popstate"); // fires in the same tick, same pathname
		await flush(1100);

		expect(pageviewCalls()).toHaveLength(2);
	});

	test("hashchange is ignored by default (no hashRouting)", async () => {
		createTracker({ key: SITE_KEY });
		await flush();

		browser.setPath("/landing", "", "#/section-2");
		browser.dispatchWindow("hashchange");
		await flush(1100);

		expect(pageviewCalls()).toHaveLength(1);
	});

	test("hashchange fires a pageview when hashRouting is enabled", async () => {
		createTracker({ key: SITE_KEY, hashRouting: true });
		await flush();

		browser.setPath("/landing", "", "#/section-2");
		browser.dispatchWindow("hashchange");
		await flush(1100);

		expect(pageviewCalls()).toHaveLength(2);
	});

	test("never patches replaceState", async () => {
		createTracker({ key: SITE_KEY });
		await flush();
		const patched = window.history.pushState;
		expect(typeof window.history.replaceState).not.toBe("function");
		expect(patched).not.toBe(undefined);
	});

	test("does not autocapture SPA navigation when trackPageviews is disabled", async () => {
		createTracker({ key: SITE_KEY, trackPageviews: false });
		await flush();

		browser.setPath("/pricing");
		browser.pushState({}, "", "/pricing");
		await flush(1100);

		expect(pageviewCalls()).toHaveLength(0);
	});
});

describe("exclusions", () => {
	test("excludes localhost by default", async () => {
		installBrowser({ href: "http://localhost:3000/" });
		createTracker({ key: SITE_KEY });
		await flush();
		expect(pageviewCalls()).toHaveLength(0);
	});

	test("captures on localhost when captureLocalhost is set", async () => {
		installBrowser({ href: "http://localhost:3000/" });
		createTracker({ key: SITE_KEY, captureLocalhost: true });
		await flush();
		expect(pageviewCalls()).toHaveLength(1);
	});

	test("excludes 127.0.0.1 by default", async () => {
		installBrowser({ href: "http://127.0.0.1:8080/" });
		createTracker({ key: SITE_KEY });
		await flush();
		expect(pageviewCalls()).toHaveLength(0);
	});

	test("excludes navigator.webdriver (headless automation)", async () => {
		installBrowser({ webdriver: true });
		createTracker({ key: SITE_KEY });
		await flush();
		expect(pageviewCalls()).toHaveLength(0);
	});

	test("excludes visitors who set the opa_ignore opt-out flag", async () => {
		installBrowser();
		browser.storage.set("opa_ignore", "true");
		createTracker({ key: SITE_KEY });
		await flush();
		expect(pageviewCalls()).toHaveLength(0);
	});

	test("a manual pageview() call also honors exclusions", async () => {
		installBrowser({ href: "http://localhost:3000/" });
		const tracker = createTracker({ key: SITE_KEY, trackPageviews: false });
		await tracker.pageview();
		expect(pageviewCalls()).toHaveLength(0);
	});
});

describe("public pageview() API", () => {
	test("does not require a clickId or a prior identify()", async () => {
		installBrowser({ href: "https://shop.example.com/checkout" });
		const tracker = createTracker({ key: SITE_KEY, trackPageviews: false });
		await tracker.pageview();
		expect(pageviewCalls()).toHaveLength(1);
		const body = pageviewCalls()[0]?.body as Record<string, unknown>;
		expect(body.clickId).toBeUndefined();
	});

	test("includes the click id when one is present", async () => {
		installBrowser({
			href: "https://shop.example.com/checkout?opa_id=click_abc",
		});
		const tracker = createTracker({ key: SITE_KEY, trackPageviews: false });
		await tracker.pageview();
		const body = pageviewCalls()[0]?.body as Record<string, unknown>;
		expect(body.clickId).toBe("click_abc");
	});

	test("accepts url/pathname/title overrides", async () => {
		const tracker = createTracker({ key: SITE_KEY, trackPageviews: false });
		await tracker.pageview({
			url: "https://shop.example.com/virtual",
			pathname: "/virtual",
			title: "Virtual Page",
		});
		const body = pageviewCalls()[0]?.body as Record<string, unknown>;
		expect(body.pathname).toBe("/virtual");
		expect(body.title).toBe("Virtual Page");
	});

	test("reflects denied consent in consentState and does not persist the visitor id", async () => {
		installBrowser({ href: "https://shop.example.com/landing" });
		const tracker = createTracker({
			key: SITE_KEY,
			trackPageviews: false,
			consent: "denied",
		});
		await tracker.pageview();
		const body = pageviewCalls()[0]?.body as Record<string, unknown>;
		expect(body.consentState).toBe("denied");
		expect(browser.cookieJar.has("opa_vid")).toBe(false);
	});

	test("parses UTM params from the current URL", async () => {
		installBrowser({
			href: "https://shop.example.com/landing?utm_source=newsletter&utm_medium=email",
		});
		const tracker = createTracker({ key: SITE_KEY, trackPageviews: false });
		await tracker.pageview();
		const body = pageviewCalls()[0]?.body as Record<string, unknown>;
		expect(body.utmSource).toBe("newsletter");
		expect(body.utmMedium).toBe("email");
	});
});

describe("getVisitorId", () => {
	test("returns a stable id across calls and persists it in a cookie", async () => {
		const tracker = createTracker({ key: SITE_KEY, trackPageviews: false });
		const first = tracker.getVisitorId();
		const second = tracker.getVisitorId();
		expect(first).toBe(second);
		expect(browser.cookieJar.get("opa_vid")).toBe(first ?? undefined);
	});

	test("reuses a visitor id already stored in the cookie", async () => {
		browser.cookieJar.set("opa_vid", "existing-vid");
		const tracker = createTracker({ key: SITE_KEY, trackPageviews: false });
		expect(tracker.getVisitorId()).toBe("existing-vid");
	});

	test("keeps the visitor id in memory only (no cookie) when consent is denied", async () => {
		const tracker = createTracker({
			key: SITE_KEY,
			trackPageviews: false,
			consent: "denied",
		});
		const id = tracker.getVisitorId();
		expect(id).toBeTruthy();
		expect(browser.cookieJar.has("opa_vid")).toBe(false);
	});

	test("setConsent(true) persists a previously in-memory visitor id", async () => {
		const tracker = createTracker({
			key: SITE_KEY,
			trackPageviews: false,
			consent: "denied",
		});
		const id = tracker.getVisitorId();
		tracker.setConsent(true);
		expect(browser.cookieJar.get("opa_vid")).toBe(id ?? undefined);
	});

	test("reset() clears the visitor id so a new one is generated next time", async () => {
		const tracker = createTracker({ key: SITE_KEY, trackPageviews: false });
		const first = tracker.getVisitorId();
		tracker.reset();
		const second = tracker.getVisitorId();
		expect(second).not.toBe(first);
	});
});

describe("session id", () => {
	test("stays the same across two pageviews with no elapsed inactivity", async () => {
		const tracker = createTracker({ key: SITE_KEY, trackPageviews: false });
		await tracker.pageview();
		const first = (pageviewCalls()[0]?.body as Record<string, unknown>)
			.sessionId;
		await tracker.pageview();
		const second = (pageviewCalls()[1]?.body as Record<string, unknown>)
			.sessionId;
		expect(second).toBe(first);
	});
});
