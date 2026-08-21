import { eraseCookie, readCookie, writeCookie } from "./cookie";
import {
	closestAnchor,
	decorateAnchor,
	decorateOutboundLinks,
} from "./outbound";
import { createTransport } from "./transport";
import type {
	IdentifyInput,
	LeadPayload,
	Tracker,
	TrackerConfig,
	TrackProperties,
} from "./types";

const DEFAULT_API_HOST = "https://api.opa.sh";
const DEFAULT_QUERY_PARAM = "opa_id";
const DEFAULT_EXPIRES_IN_DAYS = 90;
const DEFAULT_PATH = "/";
const DEFAULT_IDENTIFY_EVENT = "identify";

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

export function createTracker(config: TrackerConfig = {}): Tracker {
	const apiHost = config.apiHost ?? DEFAULT_API_HOST;
	const queryParam = config.queryParam ?? DEFAULT_QUERY_PARAM;
	const attributionModel = config.attributionModel ?? "last-click";
	const outboundDomains = config.outboundDomains ?? [];
	const identifyEventName = config.identifyEventName ?? DEFAULT_IDENTIFY_EVENT;
	const cookieDomain = config.cookie?.domain;
	const cookiePath = config.cookie?.path ?? DEFAULT_PATH;
	const expiresInDays = config.cookie?.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS;

	const siteKey =
		typeof config.key === "string" && config.key.trim().length > 0
			? config.key.trim()
			: undefined;

	let canPersist = (config.consent ?? "default") !== "denied";
	let memoryClickId: string | null = null;
	let currentExternalId: string | null = null;
	let ready = false;
	const readyQueue: Array<() => void> = [];
	let clickBound = false;

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
				return;
			}
			eraseCookie(queryParam, { domain: cookieDomain, path: cookiePath });
		} catch {
			// Never throw to the caller.
		}
	}

	function reset(): void {
		try {
			memoryClickId = null;
			currentExternalId = null;
			eraseCookie(queryParam, { domain: cookieDomain, path: cookiePath });
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
	};
}
