/**
 * Pure, DOM-free helpers for pageview identity: random id generation, UTM /
 * ad-click-id parsing from a query string, and session rotation. Kept out of
 * create-tracker.ts so the actual decision logic is unit-testable without
 * mocking `window`/`document`/`localStorage` — only plain strings and
 * numbers go in and out.
 */

/** RFC4122 v4 UUID. Uses `crypto.randomUUID()` when available (all evergreen
 * browsers); falls back to a `Math.random()`-seeded v4 shape for older
 * runtimes. Never throws — this id is a non-sensitive analytics identifier,
 * not a security token, so `Math.random()` is an acceptable fallback. */
export function generateId(): string {
	try {
		if (
			typeof crypto !== "undefined" &&
			typeof crypto.randomUUID === "function"
		) {
			return crypto.randomUUID();
		}
	} catch {
		// Fall through to the Math.random() shape below.
	}
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

export type UtmAndClickIds = {
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
	clickIdsRaw?: string;
};

const UTM_FIELDS: Array<[keyof UtmAndClickIds, string]> = [
	["utmSource", "utm_source"],
	["utmMedium", "utm_medium"],
	["utmCampaign", "utm_campaign"],
	["utmTerm", "utm_term"],
	["utmContent", "utm_content"],
];

const AD_CLICK_ID_FIELDS: Array<[keyof UtmAndClickIds, string]> = [
	["fbclid", "fbclid"],
	["gclid", "gclid"],
	["ttclid", "ttclid"],
	["msclkid", "msclkid"],
	["gadSource", "gad_source"],
	["wbraid", "wbraid"],
	["gbraid", "gbraid"],
	["kwaiClickId", "kwai_click_id"],
];

/** Long-tail click ids kept out of the top-level payload shape and bundled
 * as a single JSON string (`clickIdsRaw`) so adding more never requires a
 * schema change server-side. */
const LONG_TAIL_PARAMS = [
	"li_fat_id",
	"mc_cid",
	"igshid",
	"twclid",
	"dclid",
	"gclsrc",
];

/** Parses `utm_*` and known ad-click ids out of `location.search`. Pure —
 * takes the raw search string, never touches `window`. */
export function parseUtmAndClickIds(search: string): UtmAndClickIds {
	const out: UtmAndClickIds = {};
	let params: URLSearchParams;
	try {
		params = new URLSearchParams(search);
	} catch {
		return out;
	}
	for (const [field, param] of UTM_FIELDS) {
		const value = params.get(param);
		if (value) {
			out[field] = value;
		}
	}
	for (const [field, param] of AD_CLICK_ID_FIELDS) {
		const value = params.get(param);
		if (value) {
			out[field] = value;
		}
	}
	const longTail: Record<string, string> = {};
	for (const param of LONG_TAIL_PARAMS) {
		const value = params.get(param);
		if (value) {
			longTail[param] = value;
		}
	}
	if (Object.keys(longTail).length > 0) {
		out.clickIdsRaw = JSON.stringify(longTail);
	}
	return out;
}

/** A stable signature for "which campaign" a page's UTM params represent.
 * Empty string when no UTM params are present. */
export function utmSignature(utm: UtmAndClickIds): string {
	return [
		utm.utmSource,
		utm.utmMedium,
		utm.utmCampaign,
		utm.utmTerm,
		utm.utmContent,
	]
		.map((value) => value ?? "")
		.join("|");
}

export type SessionState = {
	sessionId: string;
	lastActivity: number;
	utmSignature: string;
};

export const DEFAULT_SESSION_INACTIVITY_MS = 30 * 60 * 1000;

/**
 * Pure session-rotation decision: given the previously stored session (if
 * any), the current time, and the current page's UTM signature, decides
 * whether to keep the existing session or start a new one.
 *
 * Rotates when:
 *   - there is no previous session, or
 *   - more than `inactivityMs` has passed since the last activity, or
 *   - the current page carries a NEW non-empty UTM signature that differs
 *     from the session's (a fresh ad click arrived mid-session).
 *
 * A page with NO UTM params never blanks out or rotates an in-progress
 * session's signature — most pageviews in a session are plain internal
 * navigation with no UTM tags at all, and that must not look like a new
 * "campaign" on every click.
 */
export function resolveSession(params: {
	previous: SessionState | null;
	now: number;
	utmSignature: string;
	inactivityMs?: number;
	createId?: () => string;
}): SessionState {
	const {
		previous,
		now,
		utmSignature: currentSignature,
		inactivityMs = DEFAULT_SESSION_INACTIVITY_MS,
		createId = generateId,
	} = params;

	const inactivityExpired =
		!previous || now - previous.lastActivity > inactivityMs;
	const utmChanged =
		!!previous &&
		currentSignature !== "" &&
		currentSignature !== previous.utmSignature;

	if (inactivityExpired || utmChanged) {
		return {
			sessionId: createId(),
			lastActivity: now,
			utmSignature: currentSignature !== "" ? currentSignature : "",
		};
	}

	return {
		sessionId: previous.sessionId,
		lastActivity: now,
		utmSignature:
			currentSignature !== "" ? currentSignature : previous.utmSignature,
	};
}
