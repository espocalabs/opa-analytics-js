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
export type {
	OpaAnalyticsProps,
	OpaClient,
	OpaProviderProps,
} from "../react/index";
export { OpaProvider, useOpa } from "../react/index";
export { OpaAnalytics } from "./analytics";
