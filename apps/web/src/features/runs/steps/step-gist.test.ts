import { describe, expect, test } from "bun:test";
import { stepGist, stepProse } from "./step-gist";

describe("the gist of a step", () => {
	test("its error first", () => {
		expect(
			stepGist({
				nodeType: "agent",
				error: "Tests failed\nat line 3",
				outputs: { summary: "Fixed it." },
			}),
		).toBe("Tests failed");
	});

	test("an Agent's summary, a Decision's note", () => {
		expect(
			stepGist({
				nodeType: "agent",
				error: null,
				outputs: { summary: " Fixed it.\nMore. " },
			}),
		).toBe("Fixed it.");
		expect(
			stepProse({ nodeType: "decision", outputs: { note: "Looks good." } }),
		).toBe("Looks good.");
	});

	test("else the last line of the log", () => {
		expect(
			stepGist({
				nodeType: "command",
				error: null,
				outputs: { log_tail: "one\ntwo\n" },
			}),
		).toBe("two");
		expect(
			stepGist({ nodeType: "command", error: null, outputs: {} }),
		).toBeUndefined();
	});

	test("a step that stood in for its node in a test run says so", () => {
		expect(
			stepGist({
				nodeType: "decision",
				error: null,
				outputs: { decision: null },
				test: "skipped",
			}),
		).toBe("Skipped");
		expect(
			stepGist({
				nodeType: "command",
				error: null,
				outputs: {},
				test: "pinned",
			}),
		).toBe("Pinned output");
		// A pinned Agent's summary is its gist.
		expect(
			stepGist({
				nodeType: "agent",
				error: null,
				outputs: { summary: "Found three leads." },
				test: "pinned",
			}),
		).toBe("Found three leads.");
	});
});
