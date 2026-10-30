import { describe, expect, test } from "bun:test";

import {
	BUN_PARTIAL,
	BUN_PIPED,
	BUN_RUN,
	BUN_TTY,
	JEST_QUIET,
	JEST_SUITE_FAILED,
	JEST_VERBOSE,
	VITEST_FLAT,
	VITEST_RUN,
	VITEST_SUITE_FAILED,
	VITEST_VERBOSE,
} from "./fixtures/js-runs";
import {
	CARGO_RUN,
	GO_PANIC_RUN,
	GO_RUN,
	GO_VERBOSE,
	GRADLE_RUN,
	MAVEN_OLD,
	MAVEN_RUN,
	PYTEST_COLLECTION_ERROR,
	PYTEST_RUN,
	PYTEST_VERBOSE,
} from "./fixtures/other-runs";
import { parseTestRun, type TestRun } from "./test-run";

/** The run, failing the test when the output did not parse. */
function parsed(output: string): TestRun {
	const run = parseTestRun(output);
	if (!run) throw new Error("expected a test run");
	return run;
}

const names = (run: TestRun) =>
	run.suites.map((suite) => [
		suite.name,
		suite.tests.map((one) => `${one.status} ${one.name}`),
	]);

describe("not a test run", () => {
	test("plain command output gives null", () => {
		expect(parseTestRun("")).toBeNull();
		expect(
			parseTestRun("total 8\ndrwxr-xr-x  4 dev  staff  128 Oct 30 10:00 src\n"),
		).toBeNull();
		expect(
			parseTestRun("On branch main\nnothing to commit, working tree clean\n"),
		).toBeNull();
		expect(
			parseTestRun(
				"$ tsc --noEmit\nsrc/a.ts(1,1): error TS2304: Cannot find name 'x'.\n",
			),
		).toBeNull();
	});

	test("words that only look like a runner's give null", () => {
		expect(
			parseTestRun("PASS the salt\nFAIL to see why\nok then\n"),
		).toBeNull();
		expect(parseTestRun("test the thing ... later\n")).toBeNull();
		expect(parseTestRun("Tests: none yet\n")).toBeNull();
	});
});

describe("bun test", () => {
	test("reads suites, tests, errors and the summary", () => {
		const run = parsed(BUN_RUN);
		expect(run.runner).toBe("bun");
		expect(run.complete).toBe(true);
		expect(run.summary).toEqual({
			passed: 3,
			failed: 2,
			skipped: 2,
			durationMs: 45,
		});
		expect(names(run)).toEqual([
			[
				"src/math.test.ts",
				[
					"passed add > adds two numbers",
					"passed add > handles negatives",
					"failed divide > throws on zero",
				],
			],
			[
				"src/strings.test.ts",
				[
					"passed trim > removes spaces",
					"skipped trim > unicode",
					"skipped trim > tabs",
					"failed trim > keeps inner spaces",
				],
			],
		]);
		const [math, strings] = run.suites;
		expect(math?.counts).toEqual({ passed: 2, failed: 1, skipped: 0 });
		const zero = math?.tests[2];
		expect(zero?.durationMs).toBe(1.2);
		expect(zero?.error?.message).toBe(
			"expect(received).toBe(expected)\n\nExpected: 0\nReceived: Infinity",
		);
		expect(zero?.error?.stack).toBe(
			"at <anonymous> (/work/shop/src/math.test.ts:4:24)",
		);
		const inner = strings?.tests[3];
		expect(inner?.error?.message).toBe(
			"TypeError: undefined is not an object (evaluating 'value.trim')",
		);
		expect(inner?.error?.stack?.split("\n")).toHaveLength(2);
	});

	test("the recap of failed tests adds no tests", () => {
		const run = parsed(BUN_RUN);
		const all = run.suites.flatMap((suite) => suite.tests);
		expect(all.filter((one) => one.status === "failed")).toHaveLength(2);
	});

	test("piped, it lists failed tests only; one file takes the summary's counts", () => {
		const run = parsed(BUN_PIPED);
		expect(names(run)).toEqual([
			["sample.test.ts", ["failed math > divides", "failed strings > trims"]],
		]);
		expect(run.suites[0]?.counts).toEqual({ passed: 1, failed: 2, skipped: 2 });
		expect(run.suites[0]?.tests[0]?.error).toEqual({
			message:
				"expect(received).toBe(expected)\n\nExpected: 0\nReceived: Infinity",
		});
		expect(run.suites[0]?.tests[1]?.error?.stack).toBe(
			"at trim (/work/shop/sample.test.ts:2:10)\nat <anonymous> (/work/shop/sample.test.ts:15:29)",
		);
	});

	test("piped, with more files, a suite counts only what it lists", () => {
		const two = BUN_PIPED.replace("across 1 file", "across 2 files");
		expect(parsed(two).suites[0]?.counts).toEqual({
			passed: 0,
			failed: 2,
			skipped: 0,
		});
	});

	test("reads the marks of a terminal, escapes gone", () => {
		const run = parsed(BUN_TTY);
		expect(names(run)).toEqual([
			[
				"src/a.test.ts",
				["passed a > one", "failed a > two", "skipped a > three"],
			],
		]);
		expect(run.summary).toEqual({
			passed: 1,
			failed: 1,
			skipped: 1,
			durationMs: 1200,
		});
	});

	test("output that still comes gives what it has", () => {
		const run = parsed(BUN_PARTIAL);
		expect(run.complete).toBe(false);
		expect(run.summary).toEqual({ passed: 3, failed: 0, skipped: 0 });
		expect(run.suites.map((suite) => suite.name)).toEqual([
			"src/queue.test.ts",
			"src/slow.test.ts",
		]);
		expect(run.suites[1]?.tests[0]?.durationMs).toBe(1500);
	});

	test("only a summary gives no suites", () => {
		const run = parsed(
			" 12 pass\n 0 fail\nRan 12 tests across 3 files. [2.10s]\n",
		);
		expect(run.suites).toEqual([]);
		expect(run.summary).toEqual({
			passed: 12,
			failed: 0,
			skipped: 0,
			durationMs: 2100,
		});
		expect(run.complete).toBe(true);
	});
});

describe("Vitest", () => {
	test("reads files with their counts, failed tests and the summary", () => {
		const run = parsed(VITEST_RUN);
		expect(run.runner).toBe("vitest");
		expect(run.complete).toBe(true);
		expect(run.summary).toEqual({
			passed: 4,
			failed: 1,
			skipped: 3,
			durationMs: 412,
		});
		expect(run.suites.map((suite) => [suite.name, suite.counts])).toEqual([
			["src/math.test.ts", { passed: 3, failed: 0, skipped: 0 }],
			["src/strings.test.ts", { passed: 1, failed: 1, skipped: 1 }],
			["src/later.test.ts", { passed: 0, failed: 0, skipped: 2 }],
		]);
		expect(run.suites[0]?.durationMs).toBe(5);
		expect(run.suites[0]?.tests).toEqual([]);
		const failed = run.suites[1]?.tests.find((one) => one.status === "failed");
		expect(failed?.name).toBe("trim > keeps inner spaces");
		expect(failed?.error?.message).toBe(
			"AssertionError: expected 'a b' to be 'ab' // Object.is equality",
		);
		expect(failed?.error?.stack).toBe("❯ src/strings.test.ts:9:22");
	});

	test("the verbose tree gives full names", () => {
		const run = parsed(VITEST_VERBOSE);
		expect(names(run)).toEqual([
			[
				"src/cart.test.ts",
				[
					"passed cart > totals > adds prices",
					"passed cart > totals > applies a discount",
					"passed cart > empties",
				],
			],
		]);
		expect(run.summary.durationMs).toBe(1020);
	});

	test("flat lines name their file", () => {
		const run = parsed(VITEST_FLAT);
		expect(names(run)).toEqual([
			[
				"src/cart.test.ts",
				["passed cart > adds prices", "failed cart > rounds"],
			],
		]);
		expect(run.suites[0]?.tests[1]?.error?.message).toBe(
			"expected 1.005 to be 1.01",
		);
	});

	test("a file that does not load is one failed test", () => {
		const run = parsed(VITEST_SUITE_FAILED);
		const broken = run.suites.find(
			(suite) => suite.name === "src/broken.test.ts",
		);
		expect(broken?.tests[0]?.name).toBe("Test file failed to run");
		expect(broken?.tests[0]?.error?.message).toContain(
			"Cannot find module './missing'",
		);
	});
});

describe("Jest", () => {
	test("reads the verbose tree, failure blocks and the summary", () => {
		const run = parsed(JEST_VERBOSE);
		expect(run.runner).toBe("jest");
		expect(run.summary).toEqual({
			passed: 3,
			failed: 1,
			skipped: 2,
			durationMs: 1234,
		});
		expect(names(run)).toEqual([
			[
				"src/math.test.js",
				["passed add › adds two numbers", "passed add › handles negatives"],
			],
			[
				"src/strings.test.js",
				[
					"passed trim › removes spaces",
					"failed trim › keeps inner spaces",
					"skipped trim › unicode",
					"skipped trim › tabs",
				],
			],
		]);
		expect(run.suites[1]?.durationMs).toBe(1020);
		const failed = run.suites[1]?.tests[1];
		expect(failed?.durationMs).toBe(4);
		expect(failed?.error?.message).toBe(
			'expect(received).toBe(expected) // Object.is equality\n\nExpected: "ab"\nReceived: "a b"',
		);
		expect(failed?.error?.stack).toBe(
			"at Object.toBe (src/strings.test.js:8:25)",
		);
	});

	test("without --verbose, failed tests come from their blocks, once", () => {
		const run = parsed(JEST_QUIET);
		expect(run.summary).toEqual({
			passed: 9,
			failed: 2,
			skipped: 0,
			durationMs: 3400,
		});
		expect(names(run)).toEqual([
			[
				"src/orders/total.test.ts",
				["failed orders › total › adds tax", "failed orders › total › rounds"],
			],
		]);
		const tax = run.suites[0]?.tests[0];
		expect(tax?.error?.message).toBe(
			"TypeError: Cannot read properties of undefined (reading 'rate')",
		);
		expect(tax?.error?.stack?.split("\n")).toHaveLength(3);
	});

	test("a suite that does not run is one failed test", () => {
		const run = parsed(JEST_SUITE_FAILED);
		expect(run.suites[0]?.tests[0]?.name).toBe("Test suite failed to run");
		expect(run.suites[0]?.tests[0]?.error?.message).toBe(
			"Cannot find module './missing' from 'src/broken.test.ts'",
		);
		expect(run.summary).toEqual({
			passed: 0,
			failed: 0,
			skipped: 0,
			durationMs: 500,
		});
	});
});

describe("pytest", () => {
	test("counts the dots per file and names failed tests", () => {
		const run = parsed(PYTEST_RUN);
		expect(run.runner).toBe("pytest");
		expect(run.summary).toEqual({
			passed: 3,
			failed: 1,
			skipped: 2,
			durationMs: 120,
		});
		expect(run.suites.map((suite) => [suite.name, suite.counts])).toEqual([
			["tests/test_math.py", { passed: 2, failed: 1, skipped: 0 }],
			["tests/test_strings.py", { passed: 1, failed: 0, skipped: 2 }],
		]);
		const divide = run.suites[0]?.tests[0];
		expect(divide?.name).toBe("test_divide");
		expect(divide?.error?.message).toBe("ZeroDivisionError: division by zero");
		expect(divide?.error?.stack).toContain("def divide(a, b):");
	});

	test("reads -v lines with classes and parameters", () => {
		const run = parsed(PYTEST_VERBOSE);
		expect(names(run)).toEqual([
			[
				"tests/test_cart.py",
				[
					"passed TestCart::test_total",
					"failed TestCart::test_discount[10-90]",
					"skipped test_empty",
				],
			],
		]);
		expect(run.suites[0]?.tests[1]?.error?.message).toBe(
			"assert 91 == 90\n +  where 91 = apply(100, 10)",
		);
	});

	test("a file that does not collect is one failed test", () => {
		const run = parsed(PYTEST_COLLECTION_ERROR);
		expect(run.summary).toEqual({
			passed: 0,
			failed: 1,
			skipped: 0,
			durationMs: 80,
		});
		expect(names(run)).toEqual([
			["tests/test_broken.py", ["failed Test file failed to run"]],
		]);
		expect(run.suites[0]?.tests[0]?.error?.message).toBe(
			"ModuleNotFoundError: No module named 'shop.missing'",
		);
	});
});

describe("Gradle", () => {
	test("reads test events, the exception and the summary", () => {
		const run = parsed(GRADLE_RUN);
		expect(run.runner).toBe("gradle");
		expect(run.complete).toBe(true);
		expect(run.summary).toEqual({
			passed: 3,
			failed: 1,
			skipped: 1,
			durationMs: 64_000,
		});
		expect(names(run)).toEqual([
			[
				"CalculatorTest",
				["passed adds two numbers()", "failed divides by zero()"],
			],
			["StringsTest", ["skipped Trim > keeps inner spaces()"]],
		]);
		const failed = run.suites[0]?.tests[1];
		expect(failed?.error?.message).toBe(
			"org.opentest4j.AssertionFailedError: expected: <0> but was: <1>",
		);
		expect(failed?.error?.stack?.split("\n")).toHaveLength(3);
	});

	test("only the summary line gives no suites", () => {
		const run = parsed("> Task :app:test\n\n42 tests completed, 2 failed\n");
		expect(run.suites).toEqual([]);
		expect(run.summary).toEqual({ passed: 40, failed: 2, skipped: 0 });
	});

	test("a test task with no test lines is no test run", () => {
		expect(
			parseTestRun(
				"> Task :compileJava\n> Task :test\n\nBUILD SUCCESSFUL in 3s\n",
			),
		).toBeNull();
	});
});

describe("Maven Surefire", () => {
	test("reads classes, failed tests and the build summary", () => {
		const run = parsed(MAVEN_RUN);
		expect(run.runner).toBe("maven");
		expect(run.complete).toBe(true);
		expect(run.summary).toEqual({
			passed: 3,
			failed: 1,
			skipped: 1,
			durationMs: 65_000,
		});
		expect(
			run.suites.map((suite) => [suite.name, suite.counts, suite.durationMs]),
		).toEqual([
			["com.example.CalculatorTest", { passed: 1, failed: 1, skipped: 1 }, 45],
			["com.example.StringsTest", { passed: 2, failed: 0, skipped: 0 }, 12],
		]);
		const failed = run.suites[0]?.tests[0];
		expect(failed?.name).toBe("dividesByZero");
		expect(failed?.error?.message).toBe(
			"org.opentest4j.AssertionFailedError: expected: <0> but was: <1>",
		);
		expect(failed?.error?.stack?.split("\n")).toHaveLength(2);
	});

	test("reads Surefire 2", () => {
		const run = parsed(MAVEN_OLD);
		expect(run.summary).toEqual({ passed: 1, failed: 1, skipped: 0 });
		expect(names(run)).toEqual([["com.example.OrderTest", ["failed totals"]]]);
		expect(run.suites[0]?.tests[0]?.error?.message).toBe(
			"java.lang.NullPointerException",
		);
	});
});

describe("go test", () => {
	test("groups tests by package and lists subtests, not their parents", () => {
		const run = parsed(GO_RUN);
		expect(run.runner).toBe("go");
		expect(run.complete).toBe(true);
		expect(names(run)).toEqual([
			[
				"example.com/shop/calc",
				["failed TestDivide", "failed TestParse/empty"],
			],
			["example.com/shop/strings", []],
		]);
		expect(run.summary).toEqual({ passed: 0, failed: 2, skipped: 0 });
		const [divide, empty] = run.suites[0]?.tests ?? [];
		expect(divide?.error?.message).toBe("calc_test.go:14: expected 0, got 1");
		expect(empty?.error?.message).toBe("parse_test.go:22: want error, got nil");
		expect(run.suites[0]?.durationMs).toBe(12);
	});

	test("reads -v, where a test prints before its result", () => {
		const run = parsed(GO_VERBOSE);
		expect(names(run)).toEqual([
			[
				"example.com/shop/calc",
				["passed TestAdd", "failed TestDivide", "skipped TestLater"],
			],
		]);
		expect(run.suites[0]?.tests[1]?.error?.message).toBe(
			"calc_test.go:14: expected 0, got 1",
		);
	});

	test("a panic is the message, its goroutine the trace", () => {
		const run = parsed(GO_PANIC_RUN);
		const lookup = run.suites[0]?.tests[0];
		expect(lookup?.error?.message).toContain(
			"panic: runtime error: index out of range",
		);
		expect(lookup?.error?.stack).toStartWith("goroutine 7 [running]:");
	});

	test("tests whose package has not finished wait in a nameless suite", () => {
		const run = parsed(
			"=== RUN   TestA\n--- PASS: TestA (0.00s)\n=== RUN   TestB\n",
		);
		expect(run.complete).toBe(false);
		expect(names(run)).toEqual([["", ["passed TestA"]]]);
	});
});

describe("cargo test", () => {
	test("reads each target, failures and adds up the results", () => {
		const run = parsed(CARGO_RUN);
		expect(run.runner).toBe("cargo");
		expect(run.complete).toBe(true);
		expect(run.summary).toEqual({
			passed: 4,
			failed: 1,
			skipped: 1,
			durationMs: 510,
		});
		expect(names(run)).toEqual([
			[
				"src/lib.rs",
				["passed tests::adds", "failed tests::divides", "skipped tests::slow"],
			],
			["tests/api.rs", ["passed lists_orders", "passed creates_order"]],
			["Doc-tests shop", ["passed src/lib.rs - add (line 5)"]],
		]);
		const divides = run.suites[0]?.tests[1];
		expect(divides?.error?.message).toBe(
			"thread 'tests::divides' panicked at src/lib.rs:20:9:\nassertion `left == right` failed\n  left: 1\n right: 0",
		);
	});

	test("a target that still runs leaves the run open", () => {
		const run = parsed("running 2 tests\ntest a ... ok\n");
		expect(run.complete).toBe(false);
		expect(run.summary).toEqual({ passed: 1, failed: 0, skipped: 0 });
	});
});

describe("large outputs", () => {
	test("a long output reads its head and tail, fast", () => {
		const noise = "x".repeat(120);
		const middle = Array.from({ length: 60_000 }, () => noise).join("\n");
		const output = `bun test v1.3.10\n\nsrc/a.test.ts:\n(pass) a > first [0.10ms]\n${middle}\n(fail) a > last [0.10ms]\n\n 1 pass\n 1 fail\nRan 2 tests across 1 file. [9.00ms]\n`;
		const started = performance.now();
		const run = parsed(output);
		expect(performance.now() - started).toBeLessThan(500);
		expect(run.summary).toEqual({
			passed: 1,
			failed: 1,
			skipped: 0,
			durationMs: 9,
		});
		expect(run.suites[0]?.tests.map((one) => one.name)).toEqual([
			"a > first",
			"a > last",
		]);
	});

	test("a long output that is no test run gives null, fast", () => {
		const output = Array.from(
			{ length: 100_000 },
			(_, i) => `line ${i} of the build log`,
		).join("\n");
		const started = performance.now();
		expect(parseTestRun(output)).toBeNull();
		expect(performance.now() - started).toBeLessThan(500);
	});
});
