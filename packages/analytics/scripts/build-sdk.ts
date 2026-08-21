import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Builds the browser CDN bundle (`/sdk.js`) from `src/browser.ts`.
 *
 * The bundle is emitted as a plain minified IIFE string wrapped in an
 * in-module constant, so the host serving `GET /sdk.js` (a Cloudflare Worker
 * in production) can return it verbatim without running esbuild at request
 * time. `build-sdk.test.ts` fails CI if that committed constant drifts from a
 * fresh build of this entry.
 *
 * Run: `bun run --cwd packages/analytics build:sdk`
 */

const ENTRY = fileURLToPath(new URL("../src/browser.ts", import.meta.url));

/** The committed artifact (`scripts/bundle.generated.ts`). */
export const OUTPUT_FILE = fileURLToPath(
	new URL("./bundle.generated.ts", import.meta.url),
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
	await Bun.write(OUTPUT_FILE, module);
	console.log(
		`[build-sdk] wrote ${(bundle.length / 1024).toFixed(2)} kB IIFE → ${OUTPUT_FILE}`,
	);
}

if (import.meta.main) {
	await main();
}
