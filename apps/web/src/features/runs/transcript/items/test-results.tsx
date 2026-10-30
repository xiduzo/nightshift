/**
 * A test run, as the Test Results pattern of AI Elements: how it added up
 * and a bar of what passed, then a line per file or class. A file with a
 * failure opens, and each failure opens on its message and its frames.
 */
import {
	parseStackTrace,
	type TestCase,
	type TestRun,
	type TestSuite,
	testCountsText,
} from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import {
	CodeBlock,
	CodeBlockContent,
	CodeBlockLine,
} from "@nightshift/ui/components/code-block";
import { Progress } from "@nightshift/ui/components/progress";
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceDescription,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "@nightshift/ui/components/trace";
import { cn } from "@nightshift/ui/lib/utils";
import { CheckIcon, CircleDashedIcon, FileCodeIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDuration } from "@/shared/format";
import { StackFrames } from "./stack-trace";

/** A file shows this many tests that passed or were skipped before "Show all". */
const SHOWN_TESTS = 50;
/** With more failures than this, each one stays closed until you open it. */
const OPEN_FAILURES = 3;

/** "0.4 ms", "120 ms", "1m 04s". */
function testTime(ms: number): string {
	if (ms < 1) return `${Math.round(ms * 10) / 10} ms`;
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return formatDuration(ms);
}

export function TestResults({ run }: { run: TestRun }) {
	const { summary } = run;
	const total = summary.passed + summary.failed + summary.skipped;
	const failures = run.suites.reduce(
		(sum, suite) =>
			sum + suite.tests.filter((test) => test.status === "failed").length,
		0,
	);
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1.5">
				<p className="flex flex-wrap items-center gap-x-1.5 text-xs">
					<span
						className={cn(
							"font-medium",
							summary.failed > 0 ? "text-destructive" : "text-foreground",
						)}
					>
						{testCountsText(summary)}
					</span>
					{summary.durationMs === undefined ? null : (
						<span className="text-muted-foreground tabular-nums">
							· {testTime(summary.durationMs)}
						</span>
					)}
					{run.complete ? null : (
						<span className="text-muted-foreground">· The tests still run</span>
					)}
				</p>
				{total > 0 ? (
					<Progress
						value={(summary.passed / total) * 100}
						aria-label="Tests that passed"
						className={cn(
							"[&_[data-slot=progress-indicator]]:bg-outcome-pass",
							summary.failed > 0 &&
								"[&_[data-slot=progress-track]]:bg-destructive/30",
						)}
					/>
				) : null}
			</div>
			{run.suites.length === 0 ? (
				<p className="text-xs">The output shows only the totals.</p>
			) : (
				<Trace>
					{run.suites.map((suite) => (
						<SuiteRow
							key={suite.name}
							suite={suite}
							openFailures={failures <= OPEN_FAILURES}
						/>
					))}
				</Trace>
			)}
		</div>
	);
}

/** One file or class: its counts, and its tests under it. */
function SuiteRow({
	suite,
	openFailures,
}: {
	suite: TestSuite;
	openFailures: boolean;
}) {
	const [all, setAll] = useState(false);
	const failed = suite.counts.failed > 0;
	const line = (
		<TraceLine status={failed ? "error" : undefined} className="text-xs">
			<TraceIcon>
				<FileCodeIcon className="size-3.5" />
			</TraceIcon>
			<TraceTitle className="font-mono">{suite.name || "Tests"}</TraceTitle>
			<TraceDescription>
				{testCountsText(suite.counts)}
				{suite.durationMs === undefined
					? null
					: ` · ${testTime(suite.durationMs)}`}
			</TraceDescription>
		</TraceLine>
	);
	if (suite.tests.length === 0) return <div>{line}</div>;
	const shown = all
		? suite.tests
		: suite.tests.filter(
				(test, index) => test.status === "failed" || index < SHOWN_TESTS,
			);
	const hidden = suite.tests.length - shown.length;
	return (
		<TraceCollapsible defaultOpen={failed}>
			<TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
			<TraceCollapsibleContent>
				<Trace>
					{shown.map((test, index) => (
						<TestRow
							// Tests only grow at the end, so the index is stable.
							key={index}
							test={test}
							open={openFailures}
						/>
					))}
					{hidden > 0 ? (
						<div>
							<Button
								variant="link"
								size="xs"
								className="px-0"
								onClick={() => setAll(true)}
							>
								Show {hidden} more {hidden === 1 ? "test" : "tests"}
							</Button>
						</div>
					) : null}
				</Trace>
			</TraceCollapsibleContent>
		</TraceCollapsible>
	);
}

function TestRow({ test, open }: { test: TestCase; open: boolean }) {
	const time =
		test.durationMs === undefined ? null : (
			<TraceDescription>{testTime(test.durationMs)}</TraceDescription>
		);
	if (test.status === "passed")
		return (
			<div>
				<TraceLine className="text-xs">
					<TraceIcon>
						<CheckIcon className="size-3.5 text-outcome-pass" />
					</TraceIcon>
					<TraceTitle>{test.name}</TraceTitle>
					{time}
				</TraceLine>
			</div>
		);
	if (test.status === "skipped")
		return (
			<div>
				<TraceLine status="pending" className="text-xs">
					<TraceIcon>
						<CircleDashedIcon className="size-3.5" />
					</TraceIcon>
					<TraceTitle>{test.name}</TraceTitle>
					<TraceDescription>Skipped</TraceDescription>
				</TraceLine>
			</div>
		);
	return (
		<TraceCollapsible defaultOpen={open}>
			<TraceCollapsibleTrigger>
				<TraceLine status="error" className="text-xs">
					<TraceIcon>
						<XIcon className="size-3.5" />
					</TraceIcon>
					<TraceTitle>{test.name}</TraceTitle>
					{time}
				</TraceLine>
			</TraceCollapsibleTrigger>
			<TraceCollapsibleContent>
				<TestFailure error={test.error} />
			</TraceCollapsibleContent>
		</TraceCollapsible>
	);
}

/** What went wrong in one test: the message, then its frames, or its trace as printed. */
function TestFailure({ error }: { error: TestCase["error"] }) {
	const frames = useMemo(
		() => (error?.stack ? (parseStackTrace(error.stack)?.frames ?? []) : []),
		[error?.stack],
	);
	if (!error) return <p className="text-xs">The output gives no reason.</p>;
	return (
		<div className="flex flex-col gap-2">
			<CodeBlock size="sm" variant="destructive">
				<CodeBlockContent wrap className="max-h-64">
					<CodeBlockLine className="wrap-anywhere">
						{error.message}
					</CodeBlockLine>
				</CodeBlockContent>
			</CodeBlock>
			{frames.length > 0 ? (
				<div className="rounded-md bg-muted p-3">
					<StackFrames frames={frames} />
				</div>
			) : error.stack ? (
				<CodeBlock size="sm">
					<CodeBlockContent wrap className="max-h-64">
						<CodeBlockLine className="wrap-anywhere">
							{error.stack}
						</CodeBlockLine>
					</CodeBlockContent>
				</CodeBlock>
			) : null}
		</div>
	);
}
