/**
 * What every test runner's parser fills in, and how the result adds up: the
 * shape of a parsed test run, and a builder that keeps suites in the order
 * the output names them.
 */

export type TestStatus = "passed" | "failed" | "skipped";

export type TestError = {
	message: string;
	/** The trace as the runner printed it, one frame per line. */
	stack?: string;
};

export type TestCase = {
	/** The name as the runner prints it, with its groups: `add > adds two numbers`. */
	name: string;
	status: TestStatus;
	durationMs?: number;
	error?: TestError;
};

export type TestCounts = { passed: number; failed: number; skipped: number };

export type TestSuite = {
	/** The test file, class or package. Empty when the output names none. */
	name: string;
	/**
	 * The tests the output lists. Often fewer than `counts` says: many runners
	 * list only the tests that failed.
	 */
	tests: TestCase[];
	counts: TestCounts;
	durationMs?: number;
};

export type TestRunner =
	| "bun"
	| "vitest"
	| "jest"
	| "pytest"
	| "gradle"
	| "maven"
	| "go"
	| "cargo";

export type TestRun = {
	runner: TestRunner;
	suites: TestSuite[];
	summary: TestCounts & { durationMs?: number };
	/** False while the run goes on: the output has no final summary yet. */
	complete: boolean;
};

export type SuiteDraft = {
	name: string;
	tests: TestCase[];
	counts?: TestCounts;
	durationMs?: number;
};

export const noCounts = (): TestCounts => ({
	passed: 0,
	failed: 0,
	skipped: 0,
});

/** Collects what a parser reads, then adds it up. */
export class RunBuilder {
	private readonly suites = new Map<string, SuiteDraft>();
	summary?: TestCounts;
	durationMs?: number;
	/** Set when the runner has no summary line but the output shows the run ended. */
	ended?: boolean;

	suite(name: string): SuiteDraft {
		let suite = this.suites.get(name);
		if (!suite) {
			suite = { name, tests: [] };
			this.suites.set(name, suite);
		}
		return suite;
	}

	add(suiteName: string, test: TestCase): TestCase {
		this.suite(suiteName).tests.push(test);
		return test;
	}

	/** The test of that name in that suite, the last one when there are more. */
	find(suiteName: string, name: string): TestCase | undefined {
		const tests = this.suites.get(suiteName)?.tests ?? [];
		for (let i = tests.length - 1; i >= 0; i--) {
			if (tests[i]?.name === name) return tests[i];
		}
		return undefined;
	}

	/** The test of that name, or a new failed one: a runner's failure report names tests it did not list. */
	failed(suiteName: string, name: string): TestCase {
		const known = this.find(suiteName, name);
		if (known) {
			known.status = "failed";
			return known;
		}
		return this.add(suiteName, { name, status: "failed" });
	}

	addCounts(suiteName: string, counts: TestCounts): void {
		const suite = this.suite(suiteName);
		const now = suite.counts ?? noCounts();
		suite.counts = {
			passed: now.passed + counts.passed,
			failed: now.failed + counts.failed,
			skipped: now.skipped + counts.skipped,
		};
	}

	addSummary(counts: TestCounts): void {
		const now = this.summary ?? noCounts();
		this.summary = {
			passed: now.passed + counts.passed,
			failed: now.failed + counts.failed,
			skipped: now.skipped + counts.skipped,
		};
	}

	/** The run, or null when the output named no test and no count. */
	finish(runner: TestRunner): TestRun | null {
		const suites: TestSuite[] = [];
		const sum = noCounts();
		for (const draft of this.suites.values()) {
			const counts = draft.counts ?? countOf(draft.tests);
			if (draft.tests.length === 0 && total(counts) === 0 && !draft.counts)
				continue;
			suites.push({
				name: draft.name,
				tests: draft.tests,
				counts,
				...(draft.durationMs === undefined
					? {}
					: { durationMs: draft.durationMs }),
			});
			sum.passed += counts.passed;
			sum.failed += counts.failed;
			sum.skipped += counts.skipped;
		}
		if (suites.length === 0 && !this.summary) return null;
		const summary = this.summary ?? sum;
		return {
			runner,
			suites,
			summary:
				this.durationMs === undefined
					? { ...summary }
					: { ...summary, durationMs: this.durationMs },
			complete: this.ended ?? this.summary !== undefined,
		};
	}
}

export function countOf(tests: TestCase[]): TestCounts {
	const counts = noCounts();
	for (const test of tests) counts[test.status]++;
	return counts;
}

export const total = (counts: TestCounts) =>
	counts.passed + counts.failed + counts.skipped;

/**
 * Counts from parts like `1 failed`, `4 passed`, `2 skipped`, `1 todo`, in
 * any order and with any separator. Errors count as failed, todos and
 * expected failures as skipped.
 */
export function countsOf(text: string): TestCounts & { total?: number } {
	const counts: TestCounts & { total?: number } = noCounts();
	for (const [, amount, word] of text.matchAll(/(\d+)\s+([a-z]+)/gi)) {
		const n = Number(amount);
		switch ((word as string).toLowerCase()) {
			case "passed":
			case "pass":
			case "xpassed":
				counts.passed += n;
				break;
			case "failed":
			case "fail":
			case "failures":
			case "error":
			case "errors":
				counts.failed += n;
				break;
			case "skipped":
			case "skip":
			case "todo":
			case "ignored":
			case "pending":
			case "xfailed":
				counts.skipped += n;
				break;
			case "total":
				counts.total = n;
				break;
		}
	}
	return counts;
}

/** The lines without their shared indent, and without blank lines at either end. */
export function dedent(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && !lines[start]?.trim()) start++;
	while (end > start && !lines[end - 1]?.trim()) end--;
	const body = lines.slice(start, end);
	let indent = Number.POSITIVE_INFINITY;
	for (const line of body) {
		if (!line.trim()) continue;
		indent = Math.min(indent, line.length - line.trimStart().length);
	}
	if (!Number.isFinite(indent) || indent === 0) return body;
	return body.map((line) => line.slice(Math.min(indent, line.length)));
}

/** An error from a message and trace lines, or undefined when both are empty. */
export function errorOf(
	message: string[],
	stack: string[] = [],
): TestError | undefined {
	const text = dedent(message).join("\n").trim();
	const trace = dedent(stack).join("\n").trim();
	if (!text && !trace) return undefined;
	return trace
		? { message: text || (trace.split("\n")[0] as string), stack: trace }
		: { message: text };
}
