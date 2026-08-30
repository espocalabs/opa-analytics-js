import { describe, expect, test } from "bun:test";
import { createTracker, OpaAnalytics, OpaProvider, useOpa } from "./index";

describe("@opa.sh/analytics/next", () => {
	test("reexports createTracker, OpaProvider, useOpa, and OpaAnalytics as functions", () => {
		expect(typeof createTracker).toBe("function");
		expect(typeof OpaProvider).toBe("function");
		expect(typeof useOpa).toBe("function");
		expect(typeof OpaAnalytics).toBe("function");
	});
});
