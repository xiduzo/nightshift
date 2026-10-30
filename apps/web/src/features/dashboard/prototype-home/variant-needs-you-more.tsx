/**
 * PROTOTYPE, throw away. Three takes on "Needs you first", to set beside C.
 *
 * - C2 "One feed": all that needs you in one list, newest first, with tabs
 *   to narrow it. Gates stay pinned on top.
 * - C3 "By cause": answer a Gate right there, and failures grouped by why
 *   they failed, so one cause that hits five projects reads as one problem.
 * - C4 "Three lanes": the numbers as a strip on top, then three columns:
 *   waiting, failed, running.
 */

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@nightshift/ui/components/accordion";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nightshift/ui/components/tabs";
import { CircleXIcon, HourglassIcon, LoaderCircleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { formatRelative, useNow } from "@/shared/format";
import { PageHeading } from "@/shared/page";
import { RangeBar } from "../range-bar";
import { LastRunsStrip } from "./home-parts";
import type { NeedsYouFailure, NeedsYouRunning } from "./needs-you-data";
import {
	FailureItem,
	GateItem,
	MetricList,
	type NeedsYouProps,
	NumbersRail,
	ProjectsCard,
	useMetricDetails,
} from "./needs-you-parts";

/** The page with the rail on the right, as in C. */
function WithRail({
	props,
	onDetails,
	children,
}: {
	props: NeedsYouProps;
	onDetails: Parameters<typeof NumbersRail>[0]["onDetails"];
	children: ReactNode;
}) {
	return (
		<div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
			<div className="flex min-w-0 flex-col gap-6">{children}</div>
			<div className="flex flex-col gap-4 lg:sticky lg:top-4">
				<NumbersRail {...props} onDetails={onDetails} />
				<ProjectsCard data={props.data} range={props.range} />
			</div>
		</div>
	);
}

function heading(props: NeedsYouProps) {
	const { data } = props;
	const count = data.gates.length + data.failed.count;
	return count === 0
		? "Nothing needs you. Your projects ran without trouble."
		: `${data.gates.length} waiting for you, ${data.failed.count} failed, ${data.runningCount} running now.`;
}

// ------------------------------------------------------------- C2 feed

/** "Today", "Yesterday", or the date: the day a failure falls under. */
function dayOf(epochMs: number, now: number): string {
	const start = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
	const days = Math.round((start(now) - start(epochMs)) / 86_400_000);
	if (days === 0) return "Today";
	if (days === 1) return "Yesterday";
	return new Date(epochMs).toLocaleDateString(undefined, {
		weekday: "long",
		day: "numeric",
		month: "short",
	});
}

export function VariantFeed(props: NeedsYouProps) {
	const { data, range } = props;
	const now = useNow();
	const details = useMetricDetails(data, range);
	const days = new Map<string, NeedsYouFailure[]>();
	for (const run of data.failed.rows) {
		const day = dayOf(run.createdAt, now);
		days.set(day, [...(days.get(day) ?? []), run]);
	}

	const gates = (
		<ItemGroup className="gap-2">
			{data.gates.map((gate) => (
				<GateItem key={gate.key} gate={gate} sample={data.sample} />
			))}
		</ItemGroup>
	);
	const running = <RunningList runs={data.running} count={data.runningCount} />;
	const failures = (
		<div className="flex flex-col gap-4">
			{[...days].map(([day, runs]) => (
				<div key={day} className="flex flex-col gap-1">
					<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
						{day} · {runs.length} failed
					</p>
					<ItemGroup className="gap-0">
						{runs.map((run) => (
							<FailureItem
								key={run.id}
								run={run}
								sample={data.sample}
								showProject
							/>
						))}
					</ItemGroup>
				</div>
			))}
		</div>
	);

	return (
		<>
			<PageHeading title="Tonight" description={heading(props)} />
			<WithRail props={props} onDetails={details.open}>
				<Card>
					<CardContent>
						<Tabs defaultValue="all">
							<TabsList variant="line">
								<TabsTrigger value="all">All</TabsTrigger>
								<TabsTrigger value="waiting">
									Waiting <Badge variant="secondary">{data.gates.length}</Badge>
								</TabsTrigger>
								<TabsTrigger value="failed">
									Failed <Badge variant="secondary">{data.failed.count}</Badge>
								</TabsTrigger>
								<TabsTrigger value="running">
									Running <Badge variant="secondary">{data.runningCount}</Badge>
								</TabsTrigger>
							</TabsList>
							<TabsContent value="all" className="flex flex-col gap-6 pt-4">
								{gates}
								{running}
								{failures}
							</TabsContent>
							<TabsContent value="waiting" className="pt-4">
								{gates}
							</TabsContent>
							<TabsContent value="failed" className="pt-4">
								{failures}
							</TabsContent>
							<TabsContent value="running" className="pt-4">
								{running}
							</TabsContent>
						</Tabs>
					</CardContent>
				</Card>
			</WithRail>
			{details.dialog}
		</>
	);
}

/** The runs at work now, with the step they are on. */
function RunningList({
	runs,
	count,
}: {
	runs: NeedsYouRunning[];
	count: number;
}) {
	const now = useNow();
	if (count === 0) return null;
	if (runs.length === 0) {
		return (
			<p className="flex items-center gap-2 text-sm">
				<LoaderCircleIcon className="size-4 animate-spin text-status-running" />
				{count} running now
			</p>
		);
	}
	return (
		<ItemGroup className="gap-1">
			{runs.map((run) => (
				<Item key={run.id} size="sm" variant="muted">
					<ItemMedia>
						<LoaderCircleIcon className="size-4 animate-spin text-status-running" />
					</ItemMedia>
					<ItemContent>
						<ItemTitle>
							{run.project} · {run.title}
						</ItemTitle>
						<ItemDescription>
							{run.step}, started {formatRelative(run.startedAt, now)}
						</ItemDescription>
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	);
}

// ------------------------------------------------------------ C3 cause

export function VariantByCause(props: NeedsYouProps) {
	const { data, range } = props;
	const now = useNow();
	const details = useMetricDetails(data, range);
	const causes = new Map<string, NeedsYouFailure[]>();
	for (const run of data.failed.rows) {
		const cause = run.reason ?? "No reason given";
		causes.set(cause, [...(causes.get(cause) ?? []), run]);
	}
	const ranked = [...causes].sort((a, b) => b[1].length - a[1].length);

	return (
		<>
			<PageHeading title="Tonight" description={heading(props)} />
			<WithRail props={props} onDetails={details.open}>
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<HourglassIcon className="size-4 text-status-waiting" />
							Answer to continue
						</CardTitle>
						<CardDescription>
							Each run waits for your answer. The buttons do nothing in this
							prototype.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ItemGroup className="gap-2">
							{data.gates.map((gate) => (
								<GateItem
									key={gate.key}
									gate={gate}
									sample={data.sample}
									showChoices
								/>
							))}
						</ItemGroup>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<CircleXIcon className="size-4 text-status-failed" />
							Why runs failed in the last {range} nights
						</CardTitle>
						<CardDescription>
							One cause can hit several projects. Fix the cause once.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Accordion multiple>
							{ranked.map(([cause, runs]) => {
								const projects = [...new Set(runs.map((run) => run.project))];
								const newest = Math.max(...runs.map((run) => run.createdAt));
								return (
									<AccordionItem key={cause} value={cause}>
										<AccordionTrigger>
											<span className="flex flex-1 flex-col gap-1.5">
												<span className="flex items-start gap-2">
													<Badge variant="destructive" className="tabular-nums">
														{runs.length}×
													</Badge>
													<span>{cause}</span>
												</span>
												<span className="flex flex-wrap items-center gap-1 font-normal text-muted-foreground text-xs">
													{projects.map((project) => (
														<Badge key={project} variant="outline">
															{project}
														</Badge>
													))}
													<span className="ml-1">
														last {formatRelative(newest, now)}
													</span>
												</span>
											</span>
										</AccordionTrigger>
										<AccordionContent>
											<ItemGroup className="gap-0">
												{runs.slice(0, 8).map((run) => (
													<FailureItem
														key={run.id}
														run={{ ...run, reason: null }}
														sample={data.sample}
														showProject
													/>
												))}
											</ItemGroup>
										</AccordionContent>
									</AccordionItem>
								);
							})}
						</Accordion>
					</CardContent>
				</Card>
			</WithRail>
			{details.dialog}
		</>
	);
}

// ----------------------------------------------------------- C4 lanes

export function VariantLanes(props: NeedsYouProps) {
	const { data, range, onRangeChange } = props;
	const now = useNow();
	const details = useMetricDetails(data, range);

	const lane = (
		icon: ReactNode,
		title: string,
		count: number,
		body: ReactNode,
	) => (
		<Card size="sm" className="min-w-0">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{icon}
					{title}
					<Badge variant="secondary">{count}</Badge>
				</CardTitle>
			</CardHeader>
			<CardContent className="max-h-[28rem] overflow-y-auto">
				{body}
			</CardContent>
		</Card>
	);

	return (
		<>
			<PageHeading title="Tonight" description={heading(props)} />
			<RangeBar value={range} onValueChange={onRangeChange} />
			<MetricList data={data} onDetails={details.open} layout="strip" />
			<div className="grid items-start gap-4 lg:grid-cols-3">
				{lane(
					<HourglassIcon className="size-4 text-status-waiting" />,
					"Waiting for you",
					data.gates.length,
					<ItemGroup className="gap-2">
						{data.gates.map((gate) => (
							<GateItem key={gate.key} gate={gate} sample={data.sample} />
						))}
					</ItemGroup>,
				)}
				{lane(
					<CircleXIcon className="size-4 text-status-failed" />,
					"Failed",
					data.failed.count,
					<ItemGroup className="gap-0">
						{data.failed.rows.slice(0, 12).map((run) => (
							<FailureItem
								key={run.id}
								run={run}
								sample={data.sample}
								showProject
							/>
						))}
					</ItemGroup>,
				)}
				{lane(
					<LoaderCircleIcon className="size-4 text-status-running" />,
					"Running now",
					data.runningCount,
					data.runningCount === 0 ? (
						<p className="text-muted-foreground text-sm">Nothing runs now.</p>
					) : (
						<RunningList runs={data.running} count={data.runningCount} />
					),
				)}
			</div>
			<Card size="sm">
				<CardHeader>
					<CardTitle>Projects</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
					{data.projects.map((project) => (
						<div key={project.id} className="flex flex-col gap-1">
							<span className="font-medium text-sm">{project.name}</span>
							<LastRunsStrip runs={project.lastRuns.slice(0, 8)} now={now} />
						</div>
					))}
				</CardContent>
			</Card>
			{details.dialog}
		</>
	);
}
