import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Tracker, TrackerConfig } from "../index";
import { OpaProvider, useOpa } from "./index";

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
	};
}

describe("OpaProvider + useOpa", () => {
	afterEach(() => {
		cleanup();
	});

	test("useOpa() returns identify, track, getClickId, setConsent, and reset from the tracker", () => {
		const tracker = fakeTracker();
		const createTracker = mock((_config?: TrackerConfig) => tracker);

		const { result } = renderHook(() => useOpa(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<OpaProvider createTracker={createTracker}>{children}</OpaProvider>
			),
		});

		expect(result.current.identify).toBe(tracker.identify);
		expect(result.current.track).toBe(tracker.track);
		expect(result.current.getClickId).toBe(tracker.getClickId);
		expect(result.current.setConsent).toBe(tracker.setConsent);
		expect(result.current.reset).toBe(tracker.reset);
	});

	test("useOpa() throws when used outside of an <OpaProvider>", () => {
		expect(() => renderHook(() => useOpa())).toThrow(
			"useOpa() must be used within an <OpaProvider>",
		);
	});

	test("creates the tracker once even when the provider re-renders", () => {
		const createTracker = mock((_config?: TrackerConfig) => fakeTracker());
		const config: TrackerConfig = { apiHost: "https://api.example.test" };

		const { rerender } = renderHook(() => useOpa(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<OpaProvider config={config} createTracker={createTracker}>
					{children}
				</OpaProvider>
			),
		});

		expect(createTracker).toHaveBeenCalledTimes(1);
		expect(createTracker).toHaveBeenCalledWith(config);

		rerender();
		rerender();

		expect(createTracker).toHaveBeenCalledTimes(1);
	});

	test("renders children", () => {
		const createTracker = mock((_config?: TrackerConfig) => fakeTracker());
		const { getByText } = render(
			<OpaProvider createTracker={createTracker}>
				<span>inside</span>
			</OpaProvider>,
		);

		expect(getByText("inside")).toBeTruthy();
	});
});
