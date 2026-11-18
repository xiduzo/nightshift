/** What a command printed, read as a person needs it: a stack trace, and the result of a test run. */

export {
	parseStackTrace,
	type StackFrame,
	type StackTrace,
} from "./stack-trace";
export {
	parseTestRun,
	type TestCase,
	type TestRun,
	type TestSuite,
	testCountsText,
} from "./test-run";
