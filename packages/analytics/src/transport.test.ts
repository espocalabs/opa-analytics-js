import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { collectEndpoint, createTransport } from "./transport";

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

describe("createTransport", () => {
	test("POSTs JSON to /v1/track/collect with the x-opa-site-key header", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		globalThis.fetch = mock(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				calls.push({ url: String(input), init: init ?? {} });
				return new Response("{}", { status: 200 });
			},
		) as unknown as typeof fetch;
		const transport = createTransport("https://api.opa.sh", SITE_KEY);
		await transport.send({
			clickId: "c1",
			eventName: "Signup",
			customerExternalId: "u1",
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://api.opa.sh/v1/track/collect");
		expect(calls[0]?.init.method).toBe("POST");
		expect(calls[0]?.init.headers).toEqual({
			"content-type": "application/json",
			"x-opa-site-key": SITE_KEY,
		});
		expect(calls[0]?.init.body).toBe(
			JSON.stringify({
				clickId: "c1",
				eventName: "Signup",
				customerExternalId: "u1",
			}),
		);
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
		await transport.send({
			clickId: "c1",
			eventName: "Signup",
			customerExternalId: "u1",
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
		void transport.send({
			clickId: "c1",
			eventName: "Signup",
			customerExternalId: "u1",
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
		expect(flush?.url).toBe("https://api.opa.sh/v1/track/collect");
		expect(flush?.init.keepalive).toBe(true);
		expect(flush?.init.headers).toEqual({
			"content-type": "application/json",
			"x-opa-site-key": SITE_KEY,
		});
		expect(JSON.parse(String(flush?.init.body))).toEqual({
			clickId: "c1",
			eventName: "Signup",
			customerExternalId: "u1",
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
		await transport.send({
			clickId: "c1",
			eventName: "Signup",
			customerExternalId: "u1",
		});
		expect(beacons).toHaveLength(1);
		expect(beacons[0]?.url).toBe("https://api.opa.sh/v1/track/collect");
		const data = beacons[0]?.data;
		const text = data instanceof Blob ? await data.text() : String(data ?? "");
		expect(JSON.parse(text)).toEqual({
			clickId: "c1",
			eventName: "Signup",
			customerExternalId: "u1",
		});
	});
});
