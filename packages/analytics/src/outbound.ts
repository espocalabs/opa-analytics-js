function normalizeDomain(domain: string): string {
	return domain
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/\/.*$/, "");
}

export function isOutboundHost(hostname: string, domains: string[]): boolean {
	const host = hostname.toLowerCase();
	for (const raw of domains) {
		const domain = normalizeDomain(raw);
		if (!domain) {
			continue;
		}
		if (host === domain || host.endsWith(`.${domain}`)) {
			return true;
		}
	}
	return false;
}

/**
 * Idempotent: an existing query param is left untouched (mirrors
 * `appendClickId` in @opa/links). Malformed hrefs are skipped, never thrown.
 */
export function appendParam(
	href: string,
	param: string,
	value: string,
	baseHref?: string,
): string {
	let url: URL;
	try {
		url = new URL(href, baseHref);
	} catch {
		return href;
	}
	if (url.searchParams.has(param)) {
		return href;
	}
	url.searchParams.set(param, value);
	return url.toString();
}

function baseHref(): string | undefined {
	try {
		return typeof window !== "undefined" ? window.location.href : undefined;
	} catch {
		return undefined;
	}
}

export function decorateAnchor(
	anchor: { href: string },
	param: string,
	clickId: string,
	domains: string[],
): void {
	if (!clickId || domains.length === 0) {
		return;
	}
	let url: URL;
	try {
		url = new URL(anchor.href, baseHref());
	} catch {
		return;
	}
	if (!isOutboundHost(url.hostname, domains)) {
		return;
	}
	anchor.href = appendParam(anchor.href, param, clickId, baseHref());
}

export function decorateOutboundLinks(
	param: string,
	clickId: string,
	domains: string[],
): void {
	if (
		typeof document === "undefined" ||
		!clickId ||
		domains.length === 0 ||
		typeof document.querySelectorAll !== "function"
	) {
		return;
	}
	try {
		const nodes = document.querySelectorAll("a[href]");
		for (let i = 0; i < nodes.length; i++) {
			decorateAnchor(
				nodes[i] as unknown as { href: string },
				param,
				clickId,
				domains,
			);
		}
	} catch {
		// Never throw from decoration.
	}
}

export function closestAnchor(
	target: EventTarget | null,
): { href: string } | null {
	if (!target || typeof target !== "object") {
		return null;
	}
	const el = target as {
		closest?: (selector: string) => { href: string } | null;
	};
	if (typeof el.closest === "function") {
		return el.closest("a[href]");
	}
	return null;
}
