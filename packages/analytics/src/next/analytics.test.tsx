import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { RefObject } from "react";
import { resetOpaAnalyticsForTests } from "../react/analytics";
import type { Tracker, TrackerConfig } from "../types";

/**
 * `mock.module()` calls are hoisted to the top of the file by Bun's test
 * runner (like `jest.mock`), so this registers before `next/navigation` is
 * first resolved by the `./index` import below.
 */
let mockPathname = "/";
let mockSearch = "";

mock.module("next/navigation", () => ({
	usePathname: () => mockPathname,
	useSearchParams: () => new URLSearchParams(mockSearch),
}));

import { OpaAnalytics, RouteChangeTracker } from "./analytics";

function fakeTracker(): Tracker {
	return {
		identify: mock(async () => {}),
		track: mock(async () => {}),
		getClickId: mock(() => null),
		setConsent: mock(() => {}),
		reset: mock(() => {}),
		ready: mock(() => {}),
		init: mock(() => {}),
		pageview: mock(async () => {}),
		getVisitorId: mock(() => null),
		setProps: mock(() => {}),
	};
}

function refOf<T>(current: T): RefObject<T> {
	return { current };
}

describe("RouteChangeTracker", () => {
	afterEach(() => {
		cleanup();
		mockPathname = "/";
		mockSearch = "";
	});

	test("does not call pageview() on the initial render", () => {
		const tracker = fakeTracker();
		const trackerRef = refOf<Tracker | null>(tracker);
		render(<RouteChangeTracker trackerRef={trackerRef} />);
		expect(tracker.pageview).not.toHaveBeenCalled();
	});

	test("calls pageview() when the pathname changes after mount", () => {
		const tracker = fakeTracker();
		const trackerRef = refOf<Tracker | null>(tracker);
		const { rerender } = render(<RouteChangeTracker trackerRef={trackerRef} />);
		expect(tracker.pageview).not.toHaveBeenCalled();

		mockPathname = "/pricing";
		rerender(<RouteChangeTracker trackerRef={trackerRef} />);
		expect(tracker.pageview).toHaveBeenCalledTimes(1);
	});

	test("calls pageview() when only the search string changes (pathname unchanged)", () => {
		const tracker = fakeTracker();
		const trackerRef = refOf<Tracker | null>(tracker);
		const { rerender } = render(<RouteChangeTracker trackerRef={trackerRef} />);

		mockSearch = "page=2";
		rerender(<RouteChangeTracker trackerRef={trackerRef} />);
		expect(tracker.pageview).toHaveBeenCalledTimes(1);
	});

	test("a re-render with the SAME pathname/search does not call pageview() again", () => {
		const tracker = fakeTracker();
		const trackerRef = refOf<Tracker | null>(tracker);
		const { rerender } = render(<RouteChangeTracker trackerRef={trackerRef} />);

		mockPathname = "/pricing";
		rerender(<RouteChangeTracker trackerRef={trackerRef} />);
		expect(tracker.pageview).toHaveBeenCalledTimes(1);

		rerender(<RouteChangeTracker trackerRef={trackerRef} />);
		expect(tracker.pageview).toHaveBeenCalledTimes(1);
	});

	test("is a no-op when the tracker ref has not been populated yet", () => {
		const trackerRef = refOf<Tracker | null>(null);
		const { rerender } = render(<RouteChangeTracker trackerRef={trackerRef} />);
		mockPathname = "/pricing";
		expect(() =>
			rerender(<RouteChangeTracker trackerRef={trackerRef} />),
		).not.toThrow();
	});
});

describe("@opa.sh/analytics/next <OpaAnalytics>", () => {
	afterEach(() => {
		cleanup();
		resetOpaAnalyticsForTests();
		mockPathname = "/";
		mockSearch = "";
	});

	test("boots exactly one tracker (via the react OpaAnalytics) and renders nothing", () => {
		const tracker = fakeTracker();
		const createTracker = mock((_config?: TrackerConfig) => tracker);
		const { container } = render(
			<OpaAnalytics
				config={{ key: "opa_pub_test" }}
				createTracker={createTracker}
			/>,
		);
		expect(container.firstChild).toBeNull();
		expect(createTracker).toHaveBeenCalledTimes(1);
	});

	test("a subsequent route change calls pageview() on the SAME tracker instance the core created", () => {
		const tracker = fakeTracker();
		const createTracker = mock((_config?: TrackerConfig) => tracker);
		const { rerender } = render(
			<OpaAnalytics config={{}} createTracker={createTracker} />,
		);
		expect(tracker.pageview).not.toHaveBeenCalled();

		mockPathname = "/pricing";
		rerender(<OpaAnalytics config={{}} createTracker={createTracker} />);

		expect(tracker.pageview).toHaveBeenCalledTimes(1);
		// Still only ONE tracker for the whole component's lifetime.
		expect(createTracker).toHaveBeenCalledTimes(1);
	});
});
