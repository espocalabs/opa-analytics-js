"use client";

import { useEffect, useRef } from "react";
import {
	createTracker as defaultCreateTracker,
	type Tracker,
	type TrackerConfig,
} from "../index";

export type OpaAnalyticsProps = {
	config?: TrackerConfig;
};

type OpaAnalyticsImplProps = OpaAnalyticsProps & {
	/** Test seam. Defaults to `@opa.sh/analytics`'s `createTracker`. */
	createTracker?: (config?: TrackerConfig) => Tracker;
	/** Internal seam: lets framework-specific wrappers (e.g.
	 * `@opa.sh/analytics/next`) capture the tracker instance this component
	 * creates, so a route-change listener can call `.pageview()` on it
	 * instead of spinning up a second tracker. Not part of the public API. */
	onReady?: (tracker: Tracker) => void;
};

let booted = false;

export function resetOpaAnalyticsForTests(): void {
	booted = false;
}

export function OpaAnalytics({
	config,
	createTracker = defaultCreateTracker,
	onReady,
}: OpaAnalyticsImplProps) {
	const created = useRef(false);
	const configRef = useRef(config);
	configRef.current = config;
	const createRef = useRef(createTracker);
	createRef.current = createTracker;
	const onReadyRef = useRef(onReady);
	onReadyRef.current = onReady;

	useEffect(() => {
		if (created.current || booted) {
			return;
		}
		created.current = true;
		booted = true;
		const tracker = createRef.current(configRef.current);
		onReadyRef.current?.(tracker);
	}, []);

	return null;
}
