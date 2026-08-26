import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { Tracker, TrackerConfig } from "../index";
import { resetOpaAnalyticsForTests } from "./analytics";
import { OpaAnalytics } from "./index";

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

describe("OpaAnalytics", () => {
	afterEach(() => {
		cleanup();
		resetOpaAnalyticsForTests();
	});

	test("creates the tracker and renders nothing", () => {
		const createTracker = mock((_config?: TrackerConfig) => fakeTracker());
		const config: TrackerConfig = { queryParam: "ref" };

		const { container } = render(
			<OpaAnalytics config={config} createTracker={createTracker} />,
		);

		expect(container.firstChild).toBeNull();
		expect(createTracker).toHaveBeenCalledTimes(1);
		expect(createTracker).toHaveBeenCalledWith(config);
	});

	test("is idempotent — a re-render does not create a second tracker", () => {
		const createTracker = mock((_config?: TrackerConfig) => fakeTracker());

		const { rerender } = render(<OpaAnalytics createTracker={createTracker} />);

		expect(createTracker).toHaveBeenCalledTimes(1);

		rerender(<OpaAnalytics createTracker={createTracker} />);
		rerender(<OpaAnalytics createTracker={createTracker} />);

		expect(createTracker).toHaveBeenCalledTimes(1);
	});

	test("a second mounted instance does not create another tracker", () => {
		const createTracker = mock((_config?: TrackerConfig) => fakeTracker());

		const { rerender } = render(<OpaAnalytics createTracker={createTracker} />);
		expect(createTracker).toHaveBeenCalledTimes(1);

		rerender(
			<>
				<OpaAnalytics createTracker={createTracker} />
				<OpaAnalytics createTracker={createTracker} />
			</>,
		);

		expect(createTracker).toHaveBeenCalledTimes(1);
	});
});
