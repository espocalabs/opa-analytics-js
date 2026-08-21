"use client";

export type {
	AttributionModel,
	ConsentMode,
	IdentifyInput,
	Tracker,
	TrackerConfig,
	TrackerCookieConfig,
	TrackProperties,
} from "@opa.sh/analytics";
export type { OpaAnalyticsProps } from "./analytics";
export { OpaAnalytics } from "./analytics";
export type { OpaClient, OpaProviderProps } from "./provider";
export { OpaProvider, useOpa } from "./provider";
