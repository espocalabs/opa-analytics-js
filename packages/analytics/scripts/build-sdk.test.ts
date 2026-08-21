import { describe, expect, test } from "bun:test";
import { buildSdkBundle } from "./build-sdk";
import { SDK_BUNDLE } from "./bundle.generated";

describe("SDK bundle", () => {
	test("bundles to a minified IIFE that wires up window.opa", async () => {
		const bundle = await buildSdkBundle();
		expect(bundle.length).toBeGreaterThan(500);
		expect(bundle).toContain("window.opa");
		// String literals from browser.ts survive minification.
		expect(bundle).toContain("data-api-host");
		expect(bundle).toContain("data-key");
		// IIFE, not an ES module — no bare `export`/`import` statements.
		expect(bundle).not.toContain("export ");
		expect(bundle).not.toMatch(/^import /m);
	});

	test("committed apps/go/app/sdk.js/bundle.generated.ts is up to date", async () => {
		const fresh = await buildSdkBundle();
		expect(SDK_BUNDLE).toBe(fresh);
	});
});
