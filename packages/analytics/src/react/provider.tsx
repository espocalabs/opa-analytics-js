"use client";

import { createContext, type ReactNode, useContext, useRef } from "react";
import {
	createTracker as defaultCreateTracker,
	type Tracker,
	type TrackerConfig,
} from "../index";

export type OpaClient = {
	identify: Tracker["identify"];
	track: Tracker["track"];
	getClickId: Tracker["getClickId"];
	setConsent: Tracker["setConsent"];
	reset: Tracker["reset"];
};

export type OpaProviderProps = {
	config?: TrackerConfig;
	children: ReactNode;
};

type OpaProviderImplProps = OpaProviderProps & {
	/** Test seam. Defaults to `@opa.sh/analytics`'s `createTracker`. */
	createTracker?: (config?: TrackerConfig) => Tracker;
};

const OpaContext = createContext<OpaClient | null>(null);

function toClient(tracker: Tracker): OpaClient {
	return {
		identify: tracker.identify,
		track: tracker.track,
		getClickId: tracker.getClickId,
		setConsent: tracker.setConsent,
		reset: tracker.reset,
	};
}

export function OpaProvider({
	config,
	children,
	createTracker = defaultCreateTracker,
}: OpaProviderImplProps) {
	const trackerRef = useRef<OpaClient | null>(null);
	if (trackerRef.current === null) {
		trackerRef.current = toClient(createTracker(config));
	}

	return (
		<OpaContext.Provider value={trackerRef.current}>
			{children}
		</OpaContext.Provider>
	);
}

export function useOpa(): OpaClient {
	const value = useContext(OpaContext);
	if (value === null) {
		throw new Error("useOpa() must be used within an <OpaProvider>");
	}
	return value;
}
