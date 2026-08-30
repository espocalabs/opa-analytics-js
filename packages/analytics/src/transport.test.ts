import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	collectEndpoint,
	createTransport,
	eventEndpoint,
	identifyEndpoint,
	pageviewEndpoint,
	sendPageview,
} from "./transport";
import type { EventPayload, IdentifyPayload, PageviewPayload } from "./types";

const originals = {
	document: globalThis.document,
	window: globalThis.window,
	navigator: globalThis.navigator,
	fetch: globalThis.fetch,
};

function restore() {
	Object.defineProperty(globalThis, "document", {
		value: originals.document,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(globalThis, "window", {
		value: originals.window,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(globalThis, "navigator", {
		value: originals.navigator,
		configurable: true,
		writable: true,
	});
	globalThis.fetch = originals.fetch;
}

beforeEach(() => {
	restore();
});

afterEach(() => {
	restore();
});

const SITE_KEY = "opa_pub_test";

describe("collectEndpoint", () => {
	test("joins apiHost with /v1/track/collect and strips a trailing slash", () => {
		expect(collectEndpoint("https://api.opa.sh")).toBe(
			"https://api.opa.sh/v1/track/collect",
		);
		expect(collectEndpoint("https://api.opa.sh/")).toBe(
			"https://api.opa.sh/v1/track/collect",
		);
	});
});

describe("identifyEndpoint", () => {
	test("joins apiHost with /v1/track/identify and strips a trailing slash", () => {
		expect(identifyEndpoint("https://api.opa.sh")).toBe(
			"https://api.opa.sh/v1/track/identify",
		);
		expect(identifyEndpoint("https://api.opa.sh/")).toBe(
			"https://api.opa.sh/v1/track/identify",
		);
	});
});

describe("eventEndpoint", () => {
	test("joins apiHost with /v1/track/event and strips a trailing slash", () => {
		expect(eventEndpoint("https://api.opa.sh")).toBe(
			"https://api.opa.sh/v1/track/event",
		);
		expect(eventEndpoint("https://api.opa.sh/")).toBe(
			"https://api.opa.sh/v1/track/event",
		);
	});
});

describe("createTransport", () => {
	test("POSTs identify JSON to /v1/track/identify with the x-opa-site-key header", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		globalThis.fetch = mock(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				calls.push({ url: String(input), init: init ?? {} });
				return new Response("{}", { status: 200 });
			},
		) as unknown as typeof fetch;
		const transport = createTransport("https://api.opa.sh", SITE_KEY);
		const payload: IdentifyPayload = {
			anonymousId: "vid_1",
			clickId: "c1",
			externalId: "u1",
			traits: { plan: "pro" },
		};
		await transport.sendIdentify(payload);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://api.opa.sh/v1/track/identify");
		expect(calls[0]?.init.method).toBe("POST");
		expect(calls[0]?.init.headers).toEqual({
			"content-type": "application/json",
			"x-opa-site-key": SITE_KEY,
		});
		expect(calls[0]?.init.body).toBe(JSON.stringify(payload));
	});

	test("POSTs event JSON to /v1/track/event with optional clickId", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		globalThis.fetch = mock(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				calls.push({ url: String(input), init: init ?? {} });
				return new Response("{}", { status: 200 });
			},
		) as unknown as typeof fetch;
		const transport = createTransport("https://api.opa.sh", SITE_KEY);
		const payload: EventPayload = {
			eventId: "evt_1",
			anonymousId: "vid_1",
			eventName: "Signup",
			properties: { plan: "free" },
		};
		await transport.sendEvent(payload);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://api.opa.sh/v1/track/event");
		expect(calls[0]?.init.headers).toEqual({
			"content-type": "application/json",
			"x-opa-site-key": SITE_KEY,
		});
		expect(calls[0]?.init.body).toBe(JSON.stringify(payload));
	});

	test("retries exactly once on a network error", async () => {
		let attempts = 0;
		globalThis.fetch = mock(async () => {
			attempts += 1;
			if (attempts === 1) {
				throw new TypeError("network");
			}
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;
		const transport = createTransport("https://api.opa.sh", SITE_KEY);
		await transport.sendEvent({
			eventId: "evt_1",
			anonymousId: "vid_1",
			clickId: "c1",
			eventName: "Signup",
			externalId: "u1",
		});
		expect(attempts).toBe(2);
	});

	test("visibilitychange to hidden flushes in-flight payloads via fetch keepalive when a key is set", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const beacons: Array<{ url: string; data: unknown }> = [];
		const docListeners = new Map<string, Array<() => void>>();
		Object.defineProperty(globalThis, "document", {
			value: {
				visibilityState: "visible" as DocumentVisibilityState,
				addEventListener(type: string, cb: () => void) {
					const list = docListeners.get(type) ?? [];
					list.push(cb);
					docListeners.set(type, list);
				},
			},
			configurable: true,
			writable: true,
		});
		Object.defineProperty(globalThis, "window", {
			value: { addEventListener() {} },
			configurable: true,
			writable: true,
		});
		Object.defineProperty(globalThis, "navigator", {
			value: {
				sendBeacon(url: string, data?: unknown) {
					beacons.push({ url, data });
					return true;
				},
			},
			configurable: true,
			writable: true,
		});
		globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(input), init: init ?? {} });
			return new Promise<Response>(() => {});
		}) as unknown as typeof fetch;

		const transport = createTransport("https://api.opa.sh", SITE_KEY);
		transport.bindUnload();
		void transport.sendEvent({
			eventId: "evt_1",
			anonymousId: "vid_1",
			clickId: "c1",
			eventName: "Signup",
			externalId: "u1",
		});
		await Promise.resolve();
		(globalThis.document as { visibilityState: string }).visibilityState =
			"hidden";
		for (const cb of docListeners.get("visibilitychange") ?? []) {
			cb();
		}
		expect(beacons).toHaveLength(0);
		expect(calls.length).toBeGreaterThanOrEqual(2);
		const flush = calls[calls.length - 1];
		expect(flush?.url).toBe("https://api.opa.sh/v1/track/event");
		expect(flush?.init.keepalive).toBe(true);
		expect(flush?.init.headers).toEqual({
			"content-type": "application/json",
			"x-opa-site-key": SITE_KEY,
		});
		expect(JSON.parse(String(flush?.init.body))).toEqual({
			eventId: "evt_1",
			anonymousId: "vid_1",
			clickId: "c1",
			eventName: "Signup",
			externalId: "u1",
		});
	});

	test("hidden send without a key still uses sendBeacon", async () => {
		const beacons: Array<{ url: string; data: unknown }> = [];
		Object.defineProperty(globalThis, "document", {
			value: { visibilityState: "hidden" as DocumentVisibilityState },
			configurable: true,
			writable: true,
		});
		Object.defineProperty(globalThis, "navigator", {
			value: {
				sendBeacon(url: string, data?: unknown) {
					beacons.push({ url, data });
					return true;
				},
			},
			configurable: true,
			writable: true,
		});
		const transport = createTransport("https://api.opa.sh");
		await transport.sendEvent({
			eventId: "evt_1",
			anonymousId: "vid_1",
			clickId: "c1",
			eventName: "Signup",
			externalId: "u1",
		});
		expect(beacons).toHaveLength(1);
		expect(beacons[0]?.url).toBe("https://api.opa.sh/v1/track/event");
		const data = beacons[0]?.data;
		const text = data instanceof Blob ? await data.text() : String(data ?? "");
		expect(JSON.parse(text)).toEqual({
			eventId: "evt_1",
			anonymousId: "vid_1",
			clickId: "c1",
			eventName: "Signup",
			externalId: "u1",
		});
	});
});

describe("pageviewEndpoint", () => {
	test("joins apiHost with /v1/track/pageview and strips a trailing slash", () => {
		expect(pageviewEndpoint("https://api.opa.sh")).toBe(
			"https://api.opa.sh/v1/track/pageview",
		);
		expect(pageviewEndpoint("https://api.opa.sh/")).toBe(
			"https://api.opa.sh/v1/track/pageview",
		);
	});
});

describe("sendPageview", () => {
	const samplePayload: PageviewPayload = {
		event: "pageview",
		anonId: "vid_1",
		sessionId: "sid_1",
		url: "https://shop.example.com/landing",
		pathname: "/landing",
		host: "shop.example.com",
		referrer: "",
		screenW: 1920,
		screenH: 1080,
		viewportW: 1280,
		viewportH: 800,
		dpr: 2,
		language: "en-US",
		timezone: "America/Sao_Paulo",
		timezoneOffset: 180,
		dnt: null,
		gpc: false,
		consentState: "default",
		ts: 1000,
	};

	test("POSTs via fetch with keepalive:true and Content-Type: text/plain", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		globalThis.fetch = mock(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				calls.push({ url: String(input), init: init ?? {} });
				return new Response("", { status: 202 });
			},
		) as unknown as typeof fetch;

		await sendPageview("https://api.opa.sh", samplePayload, "opa_pub_test");

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://api.opa.sh/v1/track/pageview");
		expect(calls[0]?.init.method).toBe("POST");
		expect(calls[0]?.init.keepalive).toBe(true);
		expect(calls[0]?.init.headers).toEqual({
			"content-type": "text/plain",
			"x-opa-site-key": "opa_pub_test",
		});
	});

	test("stamps the site key into the JSON body alongside the header", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		globalThis.fetch = mock(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				calls.push({ url: String(input), init: init ?? {} });
				return new Response("", { status: 202 });
			},
		) as unknown as typeof fetch;

		await sendPageview("https://api.opa.sh", samplePayload, "opa_pub_test");

		const body = JSON.parse(String(calls[0]?.init.body));
		expect(body.siteKey).toBe("opa_pub_test");
		expect(body.anonId).toBe("vid_1");
		expect(body.sessionId).toBe("sid_1");
		expect(body.pathname).toBe("/landing");
	});

	test("omits siteKey from headers and body when no key is configured", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		globalThis.fetch = mock(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				calls.push({ url: String(input), init: init ?? {} });
				return new Response("", { status: 202 });
			},
		) as unknown as typeof fetch;

		await sendPageview("https://api.opa.sh", samplePayload);

		expect(calls[0]?.init.headers).toEqual({ "content-type": "text/plain" });
		const body = JSON.parse(String(calls[0]?.init.body));
		expect(body.siteKey).toBeUndefined();
	});

	test("falls back to XMLHttpRequest when fetch is unavailable", async () => {
		const originalFetch = globalThis.fetch;
		const originalXhr = globalThis.XMLHttpRequest;
		delete (globalThis as { fetch?: unknown }).fetch;
		const sent: Array<{
			method: string;
			url: string;
			headers: Record<string, string>;
			body: string;
		}> = [];
		class FakeXhr {
			private method = "";
			private url = "";
			private headers: Record<string, string> = {};
			open(method: string, url: string) {
				this.method = method;
				this.url = url;
			}
			setRequestHeader(name: string, value: string) {
				this.headers[name] = value;
			}
			send(body: string) {
				sent.push({
					method: this.method,
					url: this.url,
					headers: this.headers,
					body,
				});
			}
		}
		Object.defineProperty(globalThis, "XMLHttpRequest", {
			value: FakeXhr,
			configurable: true,
			writable: true,
		});

		try {
			await sendPageview("https://api.opa.sh", samplePayload, "opa_pub_test");
		} finally {
			globalThis.fetch = originalFetch;
			Object.defineProperty(globalThis, "XMLHttpRequest", {
				value: originalXhr,
				configurable: true,
				writable: true,
			});
		}

		expect(sent).toHaveLength(1);
		expect(sent[0]?.method).toBe("POST");
		expect(sent[0]?.url).toBe("https://api.opa.sh/v1/track/pageview");
		expect(sent[0]?.headers["Content-Type"]).toBe("text/plain");
		expect(sent[0]?.headers["x-opa-site-key"]).toBe("opa_pub_test");
		expect(JSON.parse(String(sent[0]?.body)).siteKey).toBe("opa_pub_test");
	});

	test("never throws when fetch rejects", async () => {
		globalThis.fetch = mock(async () => {
			throw new TypeError("Failed to fetch");
		}) as unknown as typeof fetch;
		await expect(
			sendPageview("https://api.opa.sh", samplePayload, "opa_pub_test"),
		).resolves.toBeUndefined();
	});
});
