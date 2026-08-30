import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTracker } from "./create-tracker";

const SITE_KEY = "opa_pub_test";

/**
 * Minimal fake DOM element supporting exactly what `data-opa-event` click
 * tracking needs: `getAttribute`, `getAttributeNames` (read directly, NOT
 * via `.dataset`, matching the implementation), and `closest()` walking up
 * a `parent` chain — enough to test bubbling to a tagged ANCESTOR without a
 * real DOM.
 */
class FakeElement {
	attrs: Record<string, string>;
	parent: FakeElement | null;

	constructor(
		attrs: Record<string, string> = {},
		parent: FakeElement | null = null,
	) {
		this.attrs = attrs;
		this.parent = parent;
	}

	getAttribute(name: string): string | null {
		return Object.hasOwn(this.attrs, name) ? (this.attrs[name] ?? null) : null;
	}

	getAttributeNames(): string[] {
		return Object.keys(this.attrs);
	}

	closest(selector: string): FakeElement | null {
		const attrMatch = selector.match(/^\[([\w-]+)\]$/);
		if (!attrMatch) {
			return null;
		}
		const attr = attrMatch[1] as string;
		let node: FakeElement | null = this;
		while (node) {
			if (Object.hasOwn(node.attrs, attr)) {
				return node;
			}
			node = node.parent;
		}
		return null;
	}
}

type Listener = (event: { target: FakeElement | null }) => void;

type Browser = {
	fetchCalls: Array<{ url: string; body: unknown; init: RequestInit }>;
	click: (target: FakeElement) => void;
	setHref: (href: string) => void;
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
	webdriver?: boolean;
};

function installBrowser(options: BrowserOptions = {}): Browser {
	let currentHref = options.href ?? "https://shop.example.com/landing";
	const documentListeners = new Map<string, Listener[]>();
	const storage = new Map<string, string>();
	const cookieJar = new Map<string, string>();
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
		visibilityState: "visible" as DocumentVisibilityState,
		referrer: "",
		title: "Landing",
		addEventListener(type: string, cb: Listener) {
			const list = documentListeners.get(type) ?? [];
			list.push(cb);
			documentListeners.set(type, list);
		},
		removeEventListener() {},
		querySelectorAll() {
			return [];
		},
	};

	const window = {
		location,
		localStorage,
		history: { pushState() {} },
		screen: { width: 1920, height: 1080 },
		innerWidth: 1280,
		innerHeight: 800,
		devicePixelRatio: 2,
		addEventListener() {},
		removeEventListener() {},
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
			return new Response("{}", { status: 200 });
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
		click: (target) => {
			const event = { target };
			for (const cb of documentListeners.get("click") ?? []) {
				cb(event);
			}
		},
		setHref: (next) => {
			currentHref = next;
		},
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
});

function eventCalls() {
	return browser.fetchCalls.filter((c) => c.url.includes("/v1/track/event"));
}

function identifyCalls() {
	return browser.fetchCalls.filter((c) => c.url.includes("/v1/track/identify"));
}

async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

async function identifiedTracker(
	overrides: Parameters<typeof createTracker>[0] = {},
) {
	installBrowser({ href: "https://shop.example.com/pricing?opa_id=click_abc" });
	const tracker = createTracker({
		key: SITE_KEY,
		trackPageviews: false,
		...overrides,
	});
	await tracker.identify({ externalId: "cus_1" });
	return tracker;
}

describe("data-opa-event declarative click tracking", () => {
	test("a click on a [data-opa-event] element fires track() with the name + data-opa-* metadata", async () => {
		await identifiedTracker();
		const el = new FakeElement({
			"data-opa-event": "whatsapp_click",
			"data-opa-oferta": "black-friday",
			"data-opa-plano": "pro",
		});
		browser.click(el);
		await flush();

		expect(identifyCalls()).toHaveLength(1);
		const calls = eventCalls();
		expect(calls).toHaveLength(1);
		const body = calls[0]?.body as Record<string, unknown>;
		expect(body.eventName).toBe("whatsapp_click");
		expect(body.properties).toEqual({ oferta: "black-friday", plano: "pro" });
	});

	test("a click on a CHILD of a tagged element still fires (bubbles up via closest())", async () => {
		await identifiedTracker();
		const parent = new FakeElement({
			"data-opa-event": "cta_click",
			"data-opa-oferta": "spring",
		});
		const child = new FakeElement({}, parent);
		browser.click(child);
		await flush();

		expect(identifyCalls()).toHaveLength(1);
		const calls = eventCalls();
		expect(calls).toHaveLength(1);
		const body = calls[0]?.body as Record<string, unknown>;
		expect(body.eventName).toBe("cta_click");
		expect(body.properties).toEqual({ oferta: "spring" });
	});

	test("a click on an untagged element fires nothing", async () => {
		await identifiedTracker();
		const el = new FakeElement({ class: "button" });
		browser.click(el);
		await flush();

		expect(identifyCalls()).toHaveLength(1);
		expect(eventCalls()).toHaveLength(0);
	});

	test("kebab-case data-opa-* attributes camelCase into metadata keys", async () => {
		await identifiedTracker();
		const el = new FakeElement({
			"data-opa-event": "signup_click",
			"data-opa-plano-anual": "true",
			"data-opa-utm-source-override": "partner",
		});
		browser.click(el);
		await flush();

		const body = eventCalls()[0]?.body as Record<string, unknown>;
		expect(body.properties).toEqual({
			planoAnual: "true",
			utmSourceOverride: "partner",
		});
	});

	test("is disabled entirely via trackClicks: false", async () => {
		installBrowser({
			href: "https://shop.example.com/pricing?opa_id=click_abc",
		});
		const tracker = createTracker({
			key: SITE_KEY,
			trackPageviews: false,
			trackClicks: false,
		});
		await tracker.identify({ externalId: "cus_1" });
		const el = new FakeElement({ "data-opa-event": "whatsapp_click" });
		browser.click(el);
		await flush();

		expect(identifyCalls()).toHaveLength(1);
		expect(eventCalls()).toHaveLength(0);
	});

	test("data-track-clicks is on by default (no config needed)", async () => {
		await identifiedTracker();
		const el = new FakeElement({ "data-opa-event": "default_on_click" });
		browser.click(el);
		await flush();
		expect(identifyCalls()).toHaveLength(1);
		expect(eventCalls()).toHaveLength(1);
	});

	test("is sugar over track(): a click with NO prior identify() still sends an anonymous event", async () => {
		installBrowser({
			href: "https://shop.example.com/pricing?opa_id=click_abc",
		});
		createTracker({ key: SITE_KEY, trackPageviews: false });
		const el = new FakeElement({ "data-opa-event": "whatsapp_click" });
		browser.click(el);
		await flush();
		const calls = eventCalls();
		expect(calls).toHaveLength(1);
		const body = calls[0]?.body as Record<string, unknown>;
		expect(body.eventName).toBe("whatsapp_click");
		expect(body.externalId).toBeUndefined();
	});

	test("is sugar over track(): a click with no click id still sends", async () => {
		installBrowser({ href: "https://shop.example.com/pricing" }); // no opa_id
		createTracker({ key: SITE_KEY, trackPageviews: false });
		const el = new FakeElement({ "data-opa-event": "whatsapp_click" });
		browser.click(el);
		await flush();
		const body = eventCalls()[0]?.body as Record<string, unknown>;
		expect(body.clickId).toBeUndefined();
	});

	test("respects the same exclusions as pageview autocapture (e.g. navigator.webdriver)", async () => {
		installBrowser({
			href: "https://shop.example.com/pricing?opa_id=click_abc",
			webdriver: true,
		});
		const tracker = createTracker({ key: SITE_KEY, trackPageviews: false });
		await tracker.identify({ externalId: "cus_1" });
		const el = new FakeElement({ "data-opa-event": "whatsapp_click" });
		browser.click(el);
		await flush();

		expect(identifyCalls()).toHaveLength(1);
		expect(eventCalls()).toHaveLength(0);
	});

	test("does not track declarative clicks when consent is denied", async () => {
		installBrowser({
			href: "https://shop.example.com/pricing?opa_id=click_abc",
		});
		createTracker({
			key: SITE_KEY,
			trackPageviews: false,
			consent: "denied",
		});
		const el = new FakeElement({ "data-opa-event": "whatsapp_click" });
		browser.click(el);
		await flush();

		expect(identifyCalls()).toHaveLength(0);
		expect(eventCalls()).toHaveLength(0);
	});

	test("does not track declarative clicks when opa_ignore is set", async () => {
		installBrowser({
			href: "https://shop.example.com/pricing?opa_id=click_abc",
		});
		window.localStorage.setItem("opa_ignore", "true");
		createTracker({ key: SITE_KEY, trackPageviews: false });
		const el = new FakeElement({ "data-opa-event": "whatsapp_click" });
		browser.click(el);
		await flush();

		expect(identifyCalls()).toHaveLength(0);
		expect(eventCalls()).toHaveLength(0);
	});

	test("a missing data-opa-event value on the matched element is a no-op", async () => {
		await identifiedTracker();
		// closest() matches on the attribute's mere presence; simulate an
		// element where the attribute exists but reads back empty.
		const el = new FakeElement({ "data-opa-event": "" });
		browser.click(el);
		await flush();
		expect(identifyCalls()).toHaveLength(1);
		expect(eventCalls()).toHaveLength(0);
	});
});
