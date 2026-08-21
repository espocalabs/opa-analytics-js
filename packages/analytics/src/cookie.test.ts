import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eraseCookie, readCookie, writeCookie } from "./cookie";

const originals = {
	document: globalThis.document,
	window: globalThis.window,
};

function installCookieEnv(options: {
	persist?: boolean;
	https?: boolean;
	throwOnCookie?: boolean;
	throwOnStorage?: boolean;
}) {
	const persist = options.persist ?? true;
	const jar = new Map<string, string>();
	const storage = new Map<string, string>();
	const writes: string[] = [];

	const document = {
		get cookie() {
			if (options.throwOnCookie) {
				throw new Error("blocked");
			}
			return [...jar.entries()]
				.map(([name, value]) => `${name}=${value}`)
				.join("; ");
		},
		set cookie(raw: string) {
			if (options.throwOnCookie) {
				throw new Error("blocked");
			}
			writes.push(raw);
			if (!persist) {
				return;
			}
			const [nv, ...attrs] = raw.split(";").map((part) => part.trim());
			const eq = (nv ?? "").indexOf("=");
			const name = eq === -1 ? (nv ?? "") : (nv ?? "").slice(0, eq);
			const value = eq === -1 ? "" : (nv ?? "").slice(eq + 1);
			const maxAge = attrs.find((attr) =>
				attr.toLowerCase().startsWith("max-age="),
			);
			if (maxAge && Number(maxAge.slice("max-age=".length)) === 0) {
				jar.delete(name);
				return;
			}
			jar.set(name, value);
		},
	};

	const localStorage = {
		getItem(key: string) {
			if (options.throwOnStorage) {
				throw new Error("blocked");
			}
			return storage.has(key) ? (storage.get(key) ?? null) : null;
		},
		setItem(key: string, value: string) {
			if (options.throwOnStorage) {
				throw new Error("blocked");
			}
			storage.set(key, String(value));
		},
		removeItem(key: string) {
			if (options.throwOnStorage) {
				throw new Error("blocked");
			}
			storage.delete(key);
		},
		clear() {
			storage.clear();
		},
		key(index: number) {
			return [...storage.keys()][index] ?? null;
		},
		get length() {
			return storage.size;
		},
	};

	Object.defineProperty(globalThis, "document", {
		value: document,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(globalThis, "window", {
		value: {
			location: { protocol: options.https === false ? "http:" : "https:" },
			localStorage,
		},
		configurable: true,
		writable: true,
	});

	return { jar, storage, writes };
}

function restore() {
	Object.defineProperty(globalThis, "document", {
		value: originals.document,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(globalThis, "window", {
		value: originals.window,
		configurable: true,
		writable: true,
	});
}

beforeEach(() => {
	installCookieEnv({});
});

afterEach(() => {
	restore();
});

describe("cookie helpers", () => {
	test("write then read round-trips the value with SameSite=Lax", () => {
		const env = installCookieEnv({});
		writeCookie("opa_id", "click_1");
		expect(readCookie("opa_id")).toBe("click_1");
		expect(env.writes[0]).toContain("SameSite=Lax");
		expect(env.writes[0]).toContain("Path=/");
		expect(env.writes[0]).toContain("Max-Age=7776000");
		expect(env.writes[0]).toContain("Secure");
	});

	test("honours domain, path and expiresInDays", () => {
		const env = installCookieEnv({});
		writeCookie("opa_id", "click_1", {
			domain: ".example.com",
			path: "/app",
			expiresInDays: 30,
		});
		expect(env.writes[0]).toContain("Domain=.example.com");
		expect(env.writes[0]).toContain("Path=/app");
		expect(env.writes[0]).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
	});

	test("omits Secure on http", () => {
		const env = installCookieEnv({ https: false });
		writeCookie("opa_id", "click_1");
		expect(env.writes[0]).not.toContain("Secure");
	});

	test("erase removes the cookie", () => {
		writeCookie("opa_id", "click_1");
		expect(readCookie("opa_id")).toBe("click_1");
		eraseCookie("opa_id");
		expect(readCookie("opa_id")).toBeNull();
	});

	test("falls back to localStorage when the cookie does not stick", () => {
		const env = installCookieEnv({ persist: false });
		writeCookie("opa_id", "click_ls");
		expect(env.jar.size).toBe(0);
		expect(env.storage.get("opa_id")).toBe("click_ls");
		expect(readCookie("opa_id")).toBe("click_ls");
		eraseCookie("opa_id");
		expect(env.storage.has("opa_id")).toBe(false);
	});

	test("does not throw when document.cookie and localStorage both throw", () => {
		installCookieEnv({ throwOnCookie: true, throwOnStorage: true });
		expect(() => writeCookie("opa_id", "x")).not.toThrow();
		expect(readCookie("opa_id")).toBeNull();
		expect(() => eraseCookie("opa_id")).not.toThrow();
	});

	test("is a no-op without document (SSR)", () => {
		restore();
		try {
			delete (globalThis as Record<string, unknown>).document;
			delete (globalThis as Record<string, unknown>).window;
		} catch {
			Object.defineProperty(globalThis, "document", {
				value: undefined,
				configurable: true,
				writable: true,
			});
			Object.defineProperty(globalThis, "window", {
				value: undefined,
				configurable: true,
				writable: true,
			});
		}
		expect(() => writeCookie("opa_id", "x")).not.toThrow();
		expect(readCookie("opa_id")).toBeNull();
		expect(() => eraseCookie("opa_id")).not.toThrow();
	});
});
