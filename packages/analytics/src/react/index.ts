"use client";

export type {
	AttributionModel,
	ConsentMode,
	EventPayload,
	IdentifyInput,
	IdentifyPayload,
	PageviewOverrides,
	PageviewPayload,
	Tracker,
	TrackerConfig,
	TrackerCookieConfig,
	TrackProperties,
} from "../index";
export type { OpaAnalyticsProps } from "./analytics";
export { OpaAnalytics } from "./analytics";
export type { OpaClient, OpaProviderProps } from "./provider";
export { OpaProvider, useOpa } from "./provider";
