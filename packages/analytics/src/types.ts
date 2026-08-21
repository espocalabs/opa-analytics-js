export type AttributionModel = "last-click" | "first-click";

export type ConsentMode = "default" | "denied";

export type TrackerCookieConfig = {
	domain?: string;
	expiresInDays?: number;
	path?: string;
};

export type TrackerConfig = {
	apiHost?: string;
	/** Public site-key (`opa_pub_...`). Required to POST to `/v1/track/collect`. */
	key?: string;
	cookie?: TrackerCookieConfig;
	attributionModel?: AttributionModel;
	outboundDomains?: string[];
	consent?: ConsentMode;
	queryParam?: string;
	identifyEventName?: string;
};

export type IdentifyInput = {
	externalId: string;
	email?: string;
	name?: string;
	avatar?: string;
	[key: string]: unknown;
};

export type TrackProperties = Record<string, unknown>;

export type LeadPayload = {
	clickId: string;
	eventName: string;
	customerExternalId: string;
	customerEmail?: string;
	customerName?: string;
	customerAvatar?: string;
	metadata?: Record<string, unknown>;
};

export type Tracker = {
	identify: (input: IdentifyInput) => Promise<void>;
	track: (eventName: string, props?: TrackProperties) => Promise<void>;
	getClickId: () => string | null;
	setConsent: (granted: boolean) => void;
	reset: () => void;
	ready: (cb: () => void) => void;
	init: () => void;
};
