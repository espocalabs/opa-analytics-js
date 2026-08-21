/**
 * First-party cookie helpers with no runtime deps. `document.cookie` is the
 * primary store; localStorage is the fallback when cookies are blocked or
 * throw (Safari ITP / "Block all cookies"). Every path is SSR-safe.
 */

export type CookieWriteOptions = {
	domain?: string;
	path?: string;
	expiresInDays?: number;
};

const DEFAULT_PATH = "/";
const DEFAULT_EXPIRES_IN_DAYS = 90;
const SECONDS_PER_DAY = 24 * 60 * 60;

function encodeCookieName(name: string): string {
	return encodeURIComponent(name);
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function isHttps(): boolean {
	try {
		return (
			typeof window !== "undefined" && window.location.protocol === "https:"
		);
	} catch {
		return false;
	}
}

function serializeCookie(
	name: string,
	value: string,
	options: CookieWriteOptions,
	maxAgeSeconds: number,
): string {
	const parts = [
		`${encodeCookieName(name)}=${encodeURIComponent(value)}`,
		`Path=${options.path ?? DEFAULT_PATH}`,
		`Max-Age=${maxAgeSeconds}`,
		"SameSite=Lax",
	];
	if (options.domain) {
		parts.push(`Domain=${options.domain}`);
	}
	if (isHttps()) {
		parts.push("Secure");
	}
	return parts.join("; ");
}

function readDocumentCookie(name: string): string | null {
	if (typeof document === "undefined") {
		return null;
	}
	try {
		const encoded = encodeCookieName(name);
		const source = document.cookie;
		if (!source) {
			return null;
		}
		const pieces = source.split(/;\s*/);
		for (const piece of pieces) {
			if (!piece) {
				continue;
			}
			const eq = piece.indexOf("=");
			const key = eq === -1 ? piece : piece.slice(0, eq);
			if (key === encoded || key === name) {
				return safeDecode(eq === -1 ? "" : piece.slice(eq + 1));
			}
		}
		return null;
	} catch {
		return null;
	}
}

function getLocalStorage(): Storage | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function readLocalStorage(name: string): string | null {
	try {
		return getLocalStorage()?.getItem(name) ?? null;
	} catch {
		return null;
	}
}

function writeLocalStorage(name: string, value: string): void {
	try {
		getLocalStorage()?.setItem(name, value);
	} catch {
		// Best-effort fallback — quota / private mode / blocked storage.
	}
}

function eraseLocalStorage(name: string): void {
	try {
		getLocalStorage()?.removeItem(name);
	} catch {
		// Best-effort.
	}
}

export function readCookie(name: string): string | null {
	return readDocumentCookie(name) ?? readLocalStorage(name);
}

export function writeCookie(
	name: string,
	value: string,
	options: CookieWriteOptions = {},
): void {
	const expiresInDays = options.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS;
	const maxAge = Math.floor(expiresInDays * SECONDS_PER_DAY);
	let persisted = false;
	if (typeof document !== "undefined") {
		try {
			// biome-ignore lint/suspicious/noDocumentCookie: first-party attribution cookie, no js-cookie
			document.cookie = serializeCookie(name, value, options, maxAge);
			persisted = readDocumentCookie(name) === value;
		} catch {
			persisted = false;
		}
	}
	if (!persisted) {
		writeLocalStorage(name, value);
	}
}

export function eraseCookie(
	name: string,
	options: Pick<CookieWriteOptions, "domain" | "path"> = {},
): void {
	if (typeof document !== "undefined") {
		try {
			// biome-ignore lint/suspicious/noDocumentCookie: first-party attribution cookie, no js-cookie
			document.cookie = serializeCookie(name, "", options, 0);
		} catch {
			// Best-effort.
		}
	}
	eraseLocalStorage(name);
}
