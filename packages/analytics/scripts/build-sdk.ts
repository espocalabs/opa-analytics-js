import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Builds the browser CDN bundle (`/sdk.js`) from `src/browser.ts`.
 *
 * The bundle is emitted two ways:
 *   1. As a plain minified IIFE string wrapped in an in-module constant
 *      (`scripts/bundle.generated.ts`), so a host serving `GET /sdk.js`
 *      (a Cloudflare Worker in production) can return it verbatim without
 *      running esbuild at request time. `build-sdk.test.ts` fails CI if that
 *      committed constant drifts from a fresh build of this entry.
 *   2. As the raw, browser-loadable file `dist/sdk.js` — the exact JavaScript
 *      a `<script src=".../sdk.js">` fetches. The release workflow uploads
 *      this file to the Opa CDN (Cloudflare R2) on every `v*` tag.
 *
 * Run: `bun run --cwd packages/analytics build:sdk`
 */

const ENTRY = fileURLToPath(new URL("../src/browser.ts", import.meta.url));

/** The committed artifact (`scripts/bundle.generated.ts`). */
export const OUTPUT_FILE = fileURLToPath(
	new URL("./bundle.generated.ts", import.meta.url),
);

/** The raw browser-loadable IIFE file (`dist/sdk.js`), uploaded to the CDN. */
export const SDK_JS_FILE = fileURLToPath(
	new URL("../dist/sdk.js", import.meta.url),
);

/** esbuild the browser entry into a single minified IIFE string. */
export async function buildSdkBundle(): Promise<string> {
	const result = await build({
		entryPoints: [ENTRY],
		bundle: true,
		format: "iife",
		minify: true,
		platform: "browser",
		target: ["es2020", "chrome91", "firefox90", "safari15", "edge91"],
		legalComments: "none",
		write: false,
		// The bundle ships to production sites; strip the dev-only console.warn
		// branch guarded by NODE_ENV in create-tracker.ts.
		define: { "process.env.NODE_ENV": '"production"' },
	});
	const output = result.outputFiles?.[0];
	if (!output) {
		throw new Error("esbuild produced no output for the SDK bundle");
	}
	return output.text;
}

/** Render the generated TypeScript module wrapping the bundle string. */
export function renderGeneratedModule(bundle: string): string {
	return `// GENERATED FILE — do not edit by hand.
// Produced by packages/analytics/scripts/build-sdk.ts from src/browser.ts.
// Regenerate with: bun run --cwd packages/analytics build:sdk
// Whatever serves GET /sdk.js returns this constant verbatim; it is an
// in-module string so no Node/esbuild runs at request time.
export const SDK_BUNDLE = ${JSON.stringify(bundle)};
`;
}

async function main(): Promise<void> {
	const bundle = await buildSdkBundle();
	const module = renderGeneratedModule(bundle);
	// 1. The committed TS constant (consumed by the Worker + drift test).
	await Bun.write(OUTPUT_FILE, module);
	// 2. The raw browser file the CDN serves verbatim as GET /sdk.js.
	await Bun.write(SDK_JS_FILE, bundle);
	console.log(
		`[build-sdk] wrote ${(bundle.length / 1024).toFixed(2)} kB IIFE → ${OUTPUT_FILE}`,
	);
	console.log(`[build-sdk] wrote raw sdk.js → ${SDK_JS_FILE}`);
}

if (import.meta.main) {
	await main();
}
