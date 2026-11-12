import { describe, expect, test } from "bun:test";

import { runEvents as log } from "../testing/run-events";
import { runFacts } from "./read-model";
import { REPORT_EXCERPT_CHARS, reportExcerpt } from "./report";

/*
 * The report of a run: the report of the End step that ended it. Each test
 * builds a log, folds it, and reads the glance the run's summary carries.
 */

type Builder = ReturnType<typeof log>;

/** An End step of the run's own flow (or of a called flow, with `scope`) that wrote `report`. */
const endStep = (
	b: Builder,
	stepId: string,
	report: string,
	status: "done" | "nothing-to-do" | "failed" = "done",
	scope: { parentStepId: string; itemId: null } | null = null,
) =>
	b
		.stepStarted(stepId, "end", 1, { nodeType: "end", scope })
		.stepEnded(stepId, status, { message: "", report, visit: 1 });

const glance = (b: Builder) => runFacts(b.state()).report;

describe("the report of a run", () => {
	test("is the report of the End step that ended it", () => {
		const b = log().runStarted().stepStarted("s1", "worker").stepEnded("s1");
		endStep(b, "e1", "## News\n\nTwo new items.").ended(
			"finished",
			null,
			"done",
		);
		expect(glance(b)).toEqual({
			stepId: "e1",
			excerpt: "## News\n\nTwo new items.",
			more: false,
		});
	});

	test("a failed or nothing-to-do End gives its report too", () => {
		for (const status of ["failed", "nothing-to-do"] as const) {
			const b = log().runStarted();
			endStep(b, "e1", "Nothing changed.", status).ended(
				status === "failed" ? "failed" : "finished",
				null,
				status,
			);
			expect(glance(b)?.excerpt).toBe("Nothing changed.");
		}
	});

	test("an End with a blank report gives none", () => {
		const b = log().runStarted();
		endStep(b, "e1", "").ended("finished", null, "done");
		expect(glance(b)).toBeUndefined();
	});

	test("a run that did not end at an End node has none, nor has one that is open again", () => {
		const stopped = log().runStarted().stepStarted("s1", "worker");
		stopped.stepEnded("s1", "stopped").ended("stopped");
		expect(glance(stopped)).toBeUndefined();

		const reopened = log().runStarted();
		endStep(reopened, "e1", "First pass.").ended("finished", null, "done");
		reopened.resumed("worker");
		expect(glance(reopened)).toBeUndefined();
	});

	test("a rerun that ends at another End replaces the report", () => {
		const b = log().runStarted();
		endStep(b, "e1", "First pass.").ended("finished", null, "done");
		b.resumed("worker");
		endStep(b, "e2", "Second pass.").ended("finished", null, "done");
		expect(glance(b)).toEqual({
			stepId: "e2",
			excerpt: "Second pass.",
			more: false,
		});
	});

	test("a rerun that fails has no report, though an earlier End wrote one", () => {
		const b = log().runStarted();
		endStep(b, "e1", "First pass.").ended("finished", null, "done");
		b.resumed("worker").stepStarted("s2", "worker").stepEnded("s2", "error");
		b.ended("failed", "The agent failed.");
		expect(glance(b)).toBeUndefined();
	});

	test("the End of a called flow is not the run's report", () => {
		const b = log().runStarted().stepStarted("c1", "call", 1, {
			nodeType: "call",
		});
		endStep(b, "e1", "From the subflow.", "done", {
			parentStepId: "c1",
			itemId: null,
		});
		b.stepEnded("c1", "pass", { end_report: "From the subflow." });
		b.stepStarted("s2", "worker").stepEnded("s2");
		b.ended("finished");
		expect(glance(b)).toBeUndefined();

		// A run that ends at its own End after the Call has that End's report.
		const own = log().runStarted().stepStarted("c1", "call", 1, {
			nodeType: "call",
		});
		endStep(own, "e1", "From the subflow.", "done", {
			parentStepId: "c1",
			itemId: null,
		});
		own.stepEnded("c1", "pass");
		endStep(own, "e2", "The run's own.").ended("finished", null, "done");
		expect(glance(own)?.stepId).toBe("e2");
	});
});

describe("reportExcerpt", () => {
	test("keeps a short report whole", () => {
		expect(reportExcerpt("## News")).toEqual({
			excerpt: "## News",
			more: false,
		});
	});

	test("cuts a long report at the last line break within the cap", () => {
		const line = `${"a".repeat(49)}\n`;
		const { excerpt, more } = reportExcerpt(line.repeat(20));
		expect(more).toBe(true);
		// 12 lines of 50 characters fit in 600, with the last line break.
		expect(excerpt).toBe(line.repeat(12).trimEnd());
	});

	test("cuts one long line at a space, else before the character the cap falls in", () => {
		const words = "word ".repeat(200);
		const spaced = reportExcerpt(words);
		expect(spaced.excerpt.length).toBeLessThanOrEqual(REPORT_EXCERPT_CHARS);
		expect(spaced.excerpt.endsWith("word")).toBe(true);

		// "😀" is two UTF-16 units: the cap never splits one.
		const emoji = reportExcerpt(`a${"😀".repeat(400)}`);
		expect(emoji.more).toBe(true);
		expect(emoji.excerpt.length).toBe(REPORT_EXCERPT_CHARS - 1);
		expect(emoji.excerpt.endsWith("😀")).toBe(true);
	});
});
