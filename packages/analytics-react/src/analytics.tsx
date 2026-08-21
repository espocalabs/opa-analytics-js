"use client";

import {
	createTracker as defaultCreateTracker,
	type Tracker,
	type TrackerConfig,
} from "@opa.sh/analytics";
import { useEffect, useRef } from "react";

export type OpaAnalyticsProps = {
	config?: TrackerConfig;
};

type OpaAnalyticsImplProps = OpaAnalyticsProps & {
	/** Test seam. Defaults to `@opa.sh/analytics`'s `createTracker`. */
	createTracker?: (config?: TrackerConfig) => Tracker;
};

let booted = false;

export function resetOpaAnalyticsForTests(): void {
	booted = false;
}

export function OpaAnalytics({
	config,
	createTracker = defaultCreateTracker,
}: OpaAnalyticsImplProps) {
	const created = useRef(false);
	const configRef = useRef(config);
	configRef.current = config;
	const createRef = useRef(createTracker);
	createRef.current = createTracker;

	useEffect(() => {
		if (created.current || booted) {
			return;
		}
		created.current = true;
		booted = true;
		createRef.current(configRef.current);
	}, []);

	return null;
}
