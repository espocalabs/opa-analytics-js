import { describe, expect, test } from "bun:test";
import {
	generateId,
	parseUtmAndClickIds,
	resolveSession,
	utmSignature,
} from "./ids";

describe("generateId", () => {
	test("returns a well-formed v4 UUID string", () => {
		const id = generateId();
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
	});

	test("generates a fresh id on every call", () => {
		const a = generateId();
		const b = generateId();
		expect(a).not.toBe(b);
	});

	test("falls back to a Math.random()-seeded UUID shape when crypto.randomUUID is unavailable", () => {
		const original = globalThis.crypto;
		try {
			Object.defineProperty(globalThis, "crypto", {
				value: undefined,
				configurable: true,
				writable: true,
			});
			const id = generateId();
			expect(id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
			);
		} finally {
			Object.defineProperty(globalThis, "crypto", {
				value: original,
				configurable: true,
				writable: true,
			});
		}
	});
});

describe("parseUtmAndClickIds", () => {
	test("parses all five utm_* params", () => {
		const search =
			"?utm_source=google&utm_medium=cpc&utm_campaign=launch&utm_term=analytics&utm_content=ad1";
		expect(parseUtmAndClickIds(search)).toEqual({
			utmSource: "google",
			utmMedium: "cpc",
			utmCampaign: "launch",
			utmTerm: "analytics",
			utmContent: "ad1",
		});
	});

	test("parses each known ad-click id independently", () => {
		expect(parseUtmAndClickIds("?fbclid=fb1")).toEqual({ fbclid: "fb1" });
		expect(parseUtmAndClickIds("?gclid=g1")).toEqual({ gclid: "g1" });
		expect(parseUtmAndClickIds("?ttclid=tt1")).toEqual({ ttclid: "tt1" });
		expect(parseUtmAndClickIds("?msclkid=ms1")).toEqual({ msclkid: "ms1" });
		expect(parseUtmAndClickIds("?gad_source=1")).toEqual({ gadSource: "1" });
		expect(parseUtmAndClickIds("?wbraid=w1")).toEqual({ wbraid: "w1" });
		expect(parseUtmAndClickIds("?gbraid=gb1")).toEqual({ gbraid: "gb1" });
		expect(parseUtmAndClickIds("?kwai_click_id=k1")).toEqual({
			kwaiClickId: "k1",
		});
	});

	test("bundles long-tail click ids into a single clickIdsRaw JSON string", () => {
		const result = parseUtmAndClickIds(
			"?li_fat_id=li1&mc_cid=mc1&igshid=ig1&twclid=tw1&dclid=dc1&gclsrc=aw",
		);
		expect(result.clickIdsRaw).toBeDefined();
		expect(JSON.parse(result.clickIdsRaw as string)).toEqual({
			li_fat_id: "li1",
			mc_cid: "mc1",
			igshid: "ig1",
			twclid: "tw1",
			dclid: "dc1",
			gclsrc: "aw",
		});
	});

	test("omits clickIdsRaw entirely when no long-tail params are present", () => {
		const result = parseUtmAndClickIds("?utm_source=x");
		expect(result.clickIdsRaw).toBeUndefined();
	});

	test("returns an empty object for a query string with no known params", () => {
		expect(parseUtmAndClickIds("?foo=bar")).toEqual({});
	});

	test("returns an empty object for an empty search string", () => {
		expect(parseUtmAndClickIds("")).toEqual({});
	});

	test("never throws on a malformed search string", () => {
		expect(() => parseUtmAndClickIds("not a query string")).not.toThrow();
	});
});

describe("utmSignature", () => {
	test("is just the field separators for an object with no utm fields", () => {
		expect(utmSignature({})).toBe("||||");
	});

	test("joins the five utm fields in a stable order", () => {
		expect(
			utmSignature({
				utmSource: "google",
				utmMedium: "cpc",
				utmCampaign: "launch",
			}),
		).toBe("google|cpc|launch||");
	});

	test("two identical utm sets produce the same signature", () => {
		const a = utmSignature({ utmSource: "x", utmCampaign: "y" });
		const b = utmSignature({ utmSource: "x", utmCampaign: "y" });
		expect(a).toBe(b);
	});
});

describe("resolveSession", () => {
	const HOUR = 60 * 60 * 1000;

	test("creates a fresh session when there is no previous one", () => {
		const session = resolveSession({
			previous: null,
			now: 1000,
			utmSignature: "",
			createId: () => "id-1",
		});
		expect(session).toEqual({
			sessionId: "id-1",
			lastActivity: 1000,
			utmSignature: "",
		});
	});

	test("keeps the same session for activity within the inactivity window", () => {
		const previous = { sessionId: "s1", lastActivity: 0, utmSignature: "" };
		const session = resolveSession({
			previous,
			now: 10 * 60 * 1000, // 10 minutes later
			utmSignature: "",
			inactivityMs: 30 * 60 * 1000,
		});
		expect(session.sessionId).toBe("s1");
		expect(session.lastActivity).toBe(10 * 60 * 1000);
	});

	test("rotates the session after more than 30 minutes of inactivity", () => {
		const previous = { sessionId: "s1", lastActivity: 0, utmSignature: "" };
		const session = resolveSession({
			previous,
			now: 31 * 60 * 1000,
			utmSignature: "",
			inactivityMs: 30 * 60 * 1000,
			createId: () => "s2",
		});
		expect(session.sessionId).toBe("s2");
	});

	test("does not rotate exactly at the inactivity boundary (uses a strict >)", () => {
		const previous = { sessionId: "s1", lastActivity: 0, utmSignature: "" };
		const session = resolveSession({
			previous,
			now: 30 * 60 * 1000,
			utmSignature: "",
			inactivityMs: 30 * 60 * 1000,
			createId: () => "should-not-be-used",
		});
		expect(session.sessionId).toBe("s1");
	});

	test("rotates when a new non-empty UTM signature arrives mid-session", () => {
		const previous = {
			sessionId: "s1",
			lastActivity: 0,
			utmSignature: "google|cpc|spring",
		};
		const session = resolveSession({
			previous,
			now: HOUR - 1, // well within the inactivity window
			utmSignature: "facebook|cpc|summer",
			inactivityMs: 30 * 60 * 1000,
			createId: () => "s2",
		});
		expect(session.sessionId).toBe("s2");
		expect(session.utmSignature).toBe("facebook|cpc|summer");
	});

	test("does NOT rotate or blank the signature when a later pageview carries no UTM at all", () => {
		const previous = {
			sessionId: "s1",
			lastActivity: 0,
			utmSignature: "google|cpc|spring",
		};
		const session = resolveSession({
			previous,
			now: 60 * 1000,
			utmSignature: "",
			inactivityMs: 30 * 60 * 1000,
		});
		expect(session.sessionId).toBe("s1");
		expect(session.utmSignature).toBe("google|cpc|spring");
	});

	test("a repeat of the same non-empty UTM signature does not rotate", () => {
		const previous = {
			sessionId: "s1",
			lastActivity: 0,
			utmSignature: "google|cpc|spring",
		};
		const session = resolveSession({
			previous,
			now: 60 * 1000,
			utmSignature: "google|cpc|spring",
			inactivityMs: 30 * 60 * 1000,
			createId: () => "should-not-be-used",
		});
		expect(session.sessionId).toBe("s1");
	});

	test("uses the default 30-minute inactivity window when none is passed", () => {
		const previous = { sessionId: "s1", lastActivity: 0, utmSignature: "" };
		const stillActive = resolveSession({
			previous,
			now: 29 * 60 * 1000,
			utmSignature: "",
		});
		expect(stillActive.sessionId).toBe("s1");

		const expired = resolveSession({
			previous,
			now: 31 * 60 * 1000,
			utmSignature: "",
			createId: () => "s2",
		});
		expect(expired.sessionId).toBe("s2");
	});
});
