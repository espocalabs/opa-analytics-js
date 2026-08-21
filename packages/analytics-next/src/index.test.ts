import { describe, expect, test } from "bun:test";
import { OpaAnalytics, OpaProvider, useOpa } from "./index";

describe("@opa.sh/analytics-next", () => {
	test("reexports OpaProvider, useOpa, and OpaAnalytics as functions", () => {
		expect(typeof OpaProvider).toBe("function");
		expect(typeof useOpa).toBe("function");
		expect(typeof OpaAnalytics).toBe("function");
	});
});
