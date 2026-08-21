import type { LeadPayload } from "./types";

const COLLECT_PATH = "/v1/track/collect";
const SITE_KEY_HEADER = "x-opa-site-key";

function trimTrailingSlash(host: string): string {
	return host.replace(/\/+$/, "");
}

export function collectEndpoint(apiHost: string): string {
	return `${trimTrailingSlash(apiHost)}${COLLECT_PATH}`;
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
	send: (payload: LeadPayload) => Promise<void>;
	bindUnload: () => void;
};

export function createTransport(apiHost: string, key?: string): Transport {
	const url = collectEndpoint(apiHost);
	const headers = requestHeaders(key);
	const inFlight = new Set<string>();
	let unloadBound = false;

	function flushInFlight(): void {
		for (const body of inFlight) {
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

	function onHidden(): void {
		flushInFlight();
	}

	function onVisibilityChange(): void {
		if (isDocumentHidden()) {
			onHidden();
		}
	}

	async function send(payload: LeadPayload): Promise<void> {
		let body: string;
		try {
			body = JSON.stringify(payload);
		} catch {
			return;
		}
		inFlight.add(body);
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

	return { send, bindUnload };
}
