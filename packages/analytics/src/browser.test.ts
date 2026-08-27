import { describe, expect, test } from "bun:test";
import {
	parseScriptConfig,
	readScriptAttributes,
	type ScriptAttributes,
} from "./browser";

describe("parseScriptConfig", () => {
	test("returns an empty config when no attributes are present", () => {
		expect(parseScriptConfig({})).toEqual({});
	});

	test("maps data-api-host, data-key, model, consent, and query-param", () => {
		const attrs: ScriptAttributes = {
			apiHost: "https://api.example.com",
			key: "opa_pub_live",
			attributionModel: "first-click",
			consent: "denied",
			queryParam: "opa_ref",
		};
		expect(parseScriptConfig(attrs)).toEqual({
			apiHost: "https://api.example.com",
			key: "opa_pub_live",
			attributionModel: "first-click",
			consent: "denied",
			queryParam: "opa_ref",
		});
	});

	test("reads data-key and trims it", () => {
		expect(parseScriptConfig({ key: "  opa_pub_live  " })).toEqual({
			key: "opa_pub_live",
		});
		expect(parseScriptConfig({ key: "   " })).toEqual({});
	});

	test("trims string attributes and drops blank ones", () => {
		expect(
			parseScriptConfig({
				apiHost: "  https://api.opa.sh  ",
				queryParam: "   ",
			}),
		).toEqual({ apiHost: "https://api.opa.sh" });
	});

	test("ignores an unknown attribution model", () => {
		expect(parseScriptConfig({ attributionModel: "middle-click" })).toEqual({});
	});

	test("ignores an unknown consent mode", () => {
		expect(parseScriptConfig({ consent: "granted" })).toEqual({});
	});

	test("parses data-cookie-options JSON into the cookie config", () => {
		const config = parseScriptConfig({
			cookieOptions: JSON.stringify({
				domain: ".example.com",
				path: "/app",
				expiresInDays: 30,
			}),
		});
		expect(config.cookie).toEqual({
			domain: ".example.com",
			path: "/app",
			expiresInDays: 30,
		});
	});

	test("keeps only well-typed cookie fields", () => {
		const config = parseScriptConfig({
			cookieOptions: JSON.stringify({
				domain: 123,
				path: "/",
				expiresInDays: "forever",
			}),
		});
		expect(config.cookie).toEqual({ path: "/" });
	});

	test("tolerates malformed cookie-options JSON (no throw, field omitted)", () => {
		expect(parseScriptConfig({ cookieOptions: "{not json" })).toEqual({});
	});

	test("ignores a non-object cookie-options payload", () => {
		expect(
			parseScriptConfig({ cookieOptions: JSON.stringify([1, 2]) }),
		).toEqual({});
		expect(
			parseScriptConfig({ cookieOptions: JSON.stringify("nope") }),
		).toEqual({});
	});

	test("parses data-domains JSON array into outboundDomains", () => {
		const config = parseScriptConfig({
			domains: JSON.stringify(["shop.example.com", "app.example.com"]),
		});
		expect(config.outboundDomains).toEqual([
			"shop.example.com",
			"app.example.com",
		]);
	});

	test("drops non-string entries from the domains array", () => {
		const config = parseScriptConfig({
			domains: JSON.stringify(["a.com", 5, null, "b.com"]),
		});
		expect(config.outboundDomains).toEqual(["a.com", "b.com"]);
	});

	test("falls back to a comma-separated domains list", () => {
		const config = parseScriptConfig({ domains: "a.com, b.com ,c.com" });
		expect(config.outboundDomains).toEqual(["a.com", "b.com", "c.com"]);
	});

	test("omits outboundDomains when the array is empty", () => {
		expect(parseScriptConfig({ domains: JSON.stringify([]) })).toEqual({});
		expect(parseScriptConfig({ domains: "  " })).toEqual({});
	});

	test("null attribute values (absent data-*) yield an empty config", () => {
		const attrs: ScriptAttributes = {
			apiHost: null,
			key: null,
			attributionModel: null,
			cookieOptions: null,
			domains: null,
			consent: null,
			queryParam: null,
			trackPageviews: null,
			hashRouting: null,
			captureLocalhost: null,
			props: null,
			trackClicks: null,
		};
		expect(parseScriptConfig(attrs)).toEqual({});
	});

	test("data-track-pageviews=false disables autocapture", () => {
		expect(parseScriptConfig({ trackPageviews: "false" })).toEqual({
			trackPageviews: false,
		});
	});

	test("data-track-pageviews=true is explicit but matches the default", () => {
		expect(parseScriptConfig({ trackPageviews: "true" })).toEqual({
			trackPageviews: true,
		});
	});

	test("data-hash-routing=true and data-capture-localhost=true parse to booleans", () => {
		expect(
			parseScriptConfig({ hashRouting: "true", captureLocalhost: "true" }),
		).toEqual({ hashRouting: true, captureLocalhost: true });
	});

	test("an unrecognized boolean-flag value is ignored (falls through to the default)", () => {
		expect(parseScriptConfig({ trackPageviews: "nope" })).toEqual({});
	});

	test("parses data-props JSON into the config's default props bag", () => {
		const config = parseScriptConfig({
			props: JSON.stringify({ plan: "pro", env: "prod" }),
		});
		expect(config.props).toEqual({ plan: "pro", env: "prod" });
	});

	test("tolerates malformed data-props JSON (no throw, field omitted)", () => {
		expect(parseScriptConfig({ props: "{not json" })).toEqual({});
	});

	test("ignores a non-object data-props payload", () => {
		expect(parseScriptConfig({ props: JSON.stringify([1, 2]) })).toEqual({});
		expect(parseScriptConfig({ props: JSON.stringify("nope") })).toEqual({});
	});

	test("data-track-clicks=false disables declarative click tracking", () => {
		expect(parseScriptConfig({ trackClicks: "false" })).toEqual({
			trackClicks: false,
		});
	});
});

describe("readScriptAttributes", () => {
	test("returns an empty object for a null element", () => {
		expect(readScriptAttributes(null)).toEqual({});
	});

	test("reads the data-* attributes off an element-like object", () => {
		const values: Record<string, string> = {
			"data-api-host": "https://api.opa.sh",
			"data-key": "opa_pub_live",
			"data-attribution-model": "last-click",
			"data-cookie-options": '{"expiresInDays":7}',
			"data-domains": '["x.com"]',
			"data-consent": "default",
			"data-query-param": "opa_id",
		};
		const el = {
			getAttribute: (name: string): string | null => values[name] ?? null,
		};
		expect(readScriptAttributes(el)).toEqual({
			apiHost: "https://api.opa.sh",
			key: "opa_pub_live",
			attributionModel: "last-click",
			cookieOptions: '{"expiresInDays":7}',
			domains: '["x.com"]',
			consent: "default",
			queryParam: "opa_id",
			trackPageviews: null,
			hashRouting: null,
			captureLocalhost: null,
			props: null,
			trackClicks: null,
		});
	});

	test("round-trips element attributes into a config", () => {
		const values: Record<string, string> = {
			"data-api-host": "https://api.opa.sh",
			"data-key": "opa_pub_live",
			"data-domains": '["shop.example.com"]',
			"data-attribution-model": "first-click",
		};
		const el = {
			getAttribute: (name: string): string | null => values[name] ?? null,
		};
		expect(parseScriptConfig(readScriptAttributes(el))).toEqual({
			apiHost: "https://api.opa.sh",
			key: "opa_pub_live",
			outboundDomains: ["shop.example.com"],
			attributionModel: "first-click",
		});
	});
});
