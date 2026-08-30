import type { EventPayload, IdentifyPayload, PageviewPayload } from "./types";

const COLLECT_PATH = "/v1/track/collect";
const IDENTIFY_PATH = "/v1/track/identify";
const EVENT_PATH = "/v1/track/event";
const PAGEVIEW_PATH = "/v1/track/pageview";
const SITE_KEY_HEADER = "x-opa-site-key";

function trimTrailingSlash(host: string): string {
	return host.replace(/\/+$/, "");
}

export function collectEndpoint(apiHost: string): string {
	return `${trimTrailingSlash(apiHost)}${COLLECT_PATH}`;
}

export function identifyEndpoint(apiHost: string): string {
	return `${trimTrailingSlash(apiHost)}${IDENTIFY_PATH}`;
}

export function eventEndpoint(apiHost: string): string {
	return `${trimTrailingSlash(apiHost)}${EVENT_PATH}`;
}

export function pageviewEndpoint(apiHost: string): string {
	return `${trimTrailingSlash(apiHost)}${PAGEVIEW_PATH}`;
}

function requestHeaders(key?: string): Record<string, string> {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (key) {
		headers[SITE_KEY_HEADER] = key;
	}
	return headers;
}

/** sendBeacon cannot set custom headers; stamp the key onto the JSON body. */
function bodyWithSiteKey(body: string, key: string): string {
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>;
		if (parsed.siteKey === undefined) {
			parsed.siteKey = key;
		}
		return JSON.stringify(parsed);
	} catch {
		return body;
	}
}

/** Best-effort `XMLHttpRequest` fallback for runtimes without `fetch`
 * (very old browsers / some in-app webviews). Fire-and-forget — the pageview
 * endpoint never needs a response body client-side. */
function xhrPost(url: string, body: string, key?: string): void {
	try {
		if (typeof XMLHttpRequest === "undefined") {
			return;
		}
		const xhr = new XMLHttpRequest();
		xhr.open("POST", url, true);
		xhr.setRequestHeader("Content-Type", "text/plain");
		if (key) {
			try {
				xhr.setRequestHeader(SITE_KEY_HEADER, key);
			} catch {
				// Some restricted embeds disallow custom headers on XHR; the
				// site key is also stamped into the body as a fallback.
			}
		}
		xhr.send(body);
	} catch {
		// Never throw to the caller.
	}
}

/**
 * Sends one pageview event to `POST /v1/track/pageview`.
 *
 * Uses `fetch` with `keepalive: true` (survives the page unloading mid
 * SPA-navigation) and `Content-Type: text/plain` (a CORS "simple" content
 * type, avoiding a preflight `OPTIONS` round trip for the common case).
 * Falls back to `XMLHttpRequest` when `fetch` is unavailable. Never throws —
 * a dropped pageview must never break the host page.
 */
export async function sendPageview(
	apiHost: string,
	payload: PageviewPayload,
	key?: string,
): Promise<void> {
	const url = pageviewEndpoint(apiHost);
	let body: string;
	try {
		const withKey = key
			? { ...(payload as unknown as Record<string, unknown>), siteKey: key }
			: (payload as unknown as Record<string, unknown>);
		body = JSON.stringify(withKey);
	} catch {
		return;
	}
	const headers: Record<string, string> = { "content-type": "text/plain" };
	if (key) {
		headers[SITE_KEY_HEADER] = key;
	}
	try {
		if (typeof fetch === "function") {
			await fetch(url, {
				method: "POST",
				headers,
				body,
				credentials: "omit",
				keepalive: true,
			});
			return;
		}
	} catch {
		// Fall through to the XHR fallback below.
	}
	xhrPost(url, body, key);
}

function isDocumentHidden(): boolean {
	try {
		return (
			typeof document !== "undefined" && document.visibilityState === "hidden"
		);
	} catch {
		return false;
	}
}

function sendBeacon(url: string, body: string): boolean {
	try {
		if (
			typeof navigator === "undefined" ||
			typeof navigator.sendBeacon !== "function"
		) {
			return false;
		}
		if (typeof Blob !== "undefined") {
			return navigator.sendBeacon(
				url,
				new Blob([body], { type: "application/json" }),
			);
		}
		return navigator.sendBeacon(url, body);
	} catch {
		return false;
	}
}

async function fetchOnce(
	url: string,
	body: string,
	headers: Record<string, string>,
	keepalive?: boolean,
): Promise<void> {
	await fetch(url, {
		method: "POST",
		headers,
		body,
		credentials: "omit",
		keepalive: keepalive ?? isDocumentHidden(),
	});
}

async function fetchWithRetry(
	url: string,
	body: string,
	headers: Record<string, string>,
	beaconKey?: string,
): Promise<void> {
	if (typeof fetch !== "function") {
		sendBeacon(url, beaconKey ? bodyWithSiteKey(body, beaconKey) : body);
		return;
	}
	try {
		await fetchOnce(url, body, headers);
	} catch {
		try {
			await fetchOnce(url, body, headers);
		} catch {
			// Network exhausted — never surface to the caller.
		}
	}
}

export type Transport = {
	sendIdentify: (payload: IdentifyPayload) => Promise<void>;
	sendEvent: (payload: EventPayload) => Promise<void>;
	clear: () => void;
	bindUnload: () => void;
};

export function createTransport(apiHost: string, key?: string): Transport {
	const identifyUrl = identifyEndpoint(apiHost);
	const eventUrl = eventEndpoint(apiHost);
	const headers = requestHeaders(key);
	const inFlight = new Map<string, string>();
	let unloadBound = false;

	function flushInFlight(): void {
		for (const [body, url] of inFlight) {
			if (key && typeof fetch === "function") {
				try {
					void fetch(url, {
						method: "POST",
						headers,
						body,
						credentials: "omit",
						keepalive: true,
					}).catch(() => {
						// Unload flush is best-effort.
					});
					continue;
				} catch {
					// Fall through to sendBeacon with the key in the body.
				}
			}
			sendBeacon(url, key ? bodyWithSiteKey(body, key) : body);
		}
	}

	function clear(): void {
		inFlight.clear();
	}

	function onHidden(): void {
		flushInFlight();
	}

	function onVisibilityChange(): void {
		if (isDocumentHidden()) {
			onHidden();
		}
	}

	async function sendTo(
		url: string,
		payload: IdentifyPayload | EventPayload,
	): Promise<void> {
		let body: string;
		try {
			body = JSON.stringify(payload);
		} catch {
			return;
		}
		inFlight.set(body, url);
		try {
			if (isDocumentHidden()) {
				if (key && typeof fetch === "function") {
					await fetchWithRetry(url, body, headers, key);
					return;
				}
				if (
					!sendBeacon(url, key ? bodyWithSiteKey(body, key) : body) &&
					typeof fetch === "function"
				) {
					await fetchWithRetry(url, body, headers, key);
				}
				return;
			}
			await fetchWithRetry(url, body, headers, key);
		} catch {
			// Never throw to the caller.
		} finally {
			inFlight.delete(body);
		}
	}

	async function sendIdentify(payload: IdentifyPayload): Promise<void> {
		await sendTo(identifyUrl, payload);
	}

	async function sendEvent(payload: EventPayload): Promise<void> {
		await sendTo(eventUrl, payload);
	}

	function bindUnload(): void {
		if (unloadBound) {
			return;
		}
		unloadBound = true;
		try {
			if (typeof document !== "undefined" && document.addEventListener) {
				document.addEventListener("visibilitychange", onVisibilityChange);
			}
			if (typeof window !== "undefined" && window.addEventListener) {
				window.addEventListener("pagehide", onHidden);
			}
		} catch {
			unloadBound = false;
		}
	}

	return { sendIdentify, sendEvent, clear, bindUnload };
}
