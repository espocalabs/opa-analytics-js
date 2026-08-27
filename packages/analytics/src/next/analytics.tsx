"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import {
	type OpaAnalyticsProps,
	OpaAnalytics as ReactOpaAnalytics,
	type Tracker,
	type TrackerConfig,
} from "../react/index";

type OpaAnalyticsImplProps = OpaAnalyticsProps & {
	/** Test seam, forwarded to the underlying react `<OpaAnalytics>`. Defaults
	 * to `@opa.sh/analytics`'s `createTracker`. */
	createTracker?: (config?: TrackerConfig) => Tracker;
};

export type RouteChangeTrackerProps = {
	trackerRef: { current: Tracker | null };
};

/**
 * Fires a pageview on every client-side App Router navigation. Isolated in
 * its own component per Next's guidance for `useSearchParams()`: reading it
 * opts the nearest `<Suspense>` boundary into client-side rendering, so
 * keeping it out of the parent avoids de-opting the rest of the tree.
 *
 * Exported (but not re-exported from `./index`) as a test seam — it can be
 * rendered directly against a fake `trackerRef` without going through the
 * full tracker-creation flow.
 */
export function RouteChangeTracker({ trackerRef }: RouteChangeTrackerProps) {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const search = searchParams.toString();
	const mounted = useRef(false);

	// `search` (the query string, not the `URLSearchParams` object identity)
	// is the intentional change signal alongside `pathname`; `trackerRef` is a
	// stable ref container and `mounted` is only ever read/written inside the
	// effect, so neither belongs in the dependency list.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
	useEffect(() => {
		if (!mounted.current) {
			// The core tracker already fires the initial pageview from its own
			// `init()` (see create-tracker.ts) — this effect only reacts to a
			// SUBSEQUENT route change, never the first render.
			mounted.current = true;
			return;
		}
		void trackerRef.current?.pageview();
	}, [pathname, search]);

	return null;
}

/**
 * Next.js App Router-aware `<OpaAnalytics>`. Boots the same one-shot tracker
 * as `@opa.sh/analytics/react` (it owns the initial pageview) and
 * additionally fires a pageview on every client-side route change using
 * `usePathname()` + `useSearchParams()` — a reliability net alongside the
 * core's own `history.pushState` patch, since App Router navigation timing
 * isn't guaranteed to line up with a raw `pushState` listener across
 * versions. Both paths update the tracker's shared last-fired-path guard,
 * so a navigation that both detect is never sent twice.
 */
export function OpaAnalytics({ config, createTracker }: OpaAnalyticsImplProps) {
	const trackerRef = useRef<Tracker | null>(null);

	return (
		<>
			<ReactOpaAnalytics
				config={config}
				createTracker={createTracker}
				onReady={(tracker) => {
					trackerRef.current = tracker;
				}}
			/>
			<Suspense fallback={null}>
				<RouteChangeTracker trackerRef={trackerRef} />
			</Suspense>
		</>
	);
}
