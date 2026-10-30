/**
 * PROTOTYPE, throw away. Home variant C4, "Three lanes": the numbers as a
 * strip on top, then three lanes of equal height in the order you act on
 * them: running, waiting for you, failed. Every row is an Item that opens
 * its place: a run its run page, a Gate its question in the inbox, a
 * project its page. On sample data a row says where it would go instead.
 */

import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	ChevronRightIcon,
	CircleCheckIcon,
	CircleXIcon,
	HourglassIcon,
	LoaderCircleIcon,
	MoonIcon,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { toast } from "sonner";
import type { NightRange } from "@/shared/api";
import { formatRelative, formatTime, useNow } from "@/shared/format";
import { PageHeading } from "@/shared/page";
import { RangeBar } from "../range-bar";
import { LastRunsStrip } from "./home-parts";
import {
	MetricList,
	type NeedsYouProps,
	useMetricDetails,
} from "./needs-you-parts";

type Target =
	| { to: "run"; runId: string; label: string }
	| { to: "gate"; stepId: string; label: string }
	| { to: "project"; projectId: string; range: NightRange; label: string };

/**
 * Where a row goes, for an Item's `render`. Sample rows have nowhere real
 * to go, so they say where they would.
 */
function linkTo(target: Target, sample: boolean): ReactElement {
	if (sample) {
		return (
			<button
				type="button"
				className="w-full text-left"
				onClick={() => toast(`Sample data. This opens ${target.label}.`)}
			/>
		);
	}
	if (target.to === "run") {
		return <Link to="/runs/$runId" params={{ runId: target.runId }} />;
	}
	if (target.to === "gate") {
		return <Link to="/inbox" search={{ gate: target.stepId }} />;
	}
	return (
		<Link
			to="/projects/$projectId"
			params={{ projectId: target.projectId }}
			search={{ range: target.range }}
		/>
	);
}

export function VariantLanes(props: NeedsYouProps) {
	const { data, range, onRangeChange } = props;
	const now = useNow();
	const details = useMetricDetails(data, range);
	const { sample } = data;

	return (
		<>
			<PageHeading
				title="Tonight"
				description={
					data.gates.length + data.failed.count === 0
						? "Nothing needs you. Your projects ran without trouble."
						: `${data.runningCount} running now, ${data.gates.length} waiting for you, ${data.failed.count} failed.`
				}
			/>
			<RangeBar value={range} onValueChange={onRangeChange} />
			<MetricList data={data} onDetails={details.open} layout="strip" />

			<div className="grid gap-4 lg:grid-cols-3">
				<Lane
					icon={<LoaderCircleIcon className="text-status-running" />}
					title="Running now"
					count={data.runningCount}
					empty={{
						icon: <MoonIcon />,
						title: "Nothing runs now",
						description:
							"Start a flow from a project, or let its schedule start it tonight.",
					}}
				>
					{data.running.map((run) => (
						<Item
							key={run.id}
							variant="outline"
							size="sm"
							render={linkTo(
								{ to: "run", runId: run.id, label: `the run ${run.title}` },
								sample,
							)}
						>
							<ItemMedia variant="icon">
								{run.wakeAt ? (
									<MoonIcon className="text-status-sleeping" />
								) : (
									<LoaderCircleIcon className="animate-spin text-status-running" />
								)}
							</ItemMedia>
							<ItemContent>
								<ItemTitle>
									{run.project} · {run.title}
								</ItemTitle>
								<ItemDescription>
									{run.wakeAt
										? `Continues at ${formatTime(run.wakeAt)}`
										: run.step
											? `${run.step}, started ${formatRelative(run.startedAt, now)}`
											: `Started ${formatRelative(run.startedAt, now)}`}
								</ItemDescription>
							</ItemContent>
							<ItemActions>
								<ChevronRightIcon className="size-4 text-muted-foreground" />
							</ItemActions>
						</Item>
					))}
				</Lane>

				<Lane
					icon={<HourglassIcon className="text-status-waiting" />}
					title="Waiting for you"
					count={data.gates.length}
					action={
						<Button
							variant="ghost"
							size="sm"
							nativeButton={false}
							render={<Link to="/inbox" />}
						>
							Inbox
							<ArrowRightIcon data-icon="inline-end" />
						</Button>
					}
					empty={{
						icon: <HourglassIcon />,
						title: "Nothing waits for you",
						description: "A run asks you here when it needs your decision.",
					}}
				>
					{data.gates.map((gate) => (
						<Item
							key={gate.key}
							variant="outline"
							size="sm"
							render={linkTo(
								{
									to: "gate",
									stepId: gate.stepId,
									label: "this question in the inbox",
								},
								sample,
							)}
						>
							<ItemContent>
								<ItemTitle className="line-clamp-2">{gate.question}</ItemTitle>
								<ItemDescription>
									{gate.projectName} · {gate.flowName ?? gate.runTitle} · waits
									since {formatRelative(gate.openedAt, now)}
								</ItemDescription>
							</ItemContent>
							<ItemActions>
								<ChevronRightIcon className="size-4 text-muted-foreground" />
							</ItemActions>
						</Item>
					))}
				</Lane>

				<Lane
					icon={<CircleXIcon className="text-status-failed" />}
					title="Failed"
					count={data.failed.count}
					empty={{
						icon: <CircleCheckIcon />,
						title: "No run failed",
						description: `No run failed in the last ${range} nights.`,
					}}
				>
					{data.failed.rows.map((run) => (
						<Item
							key={run.id}
							variant="outline"
							size="sm"
							render={linkTo(
								{ to: "run", runId: run.id, label: `the run ${run.title}` },
								sample,
							)}
						>
							<ItemContent>
								<ItemTitle>
									{run.project} · {run.title}
								</ItemTitle>
								<ItemDescription className="line-clamp-2">
									{run.reason ?? "No reason given"}
								</ItemDescription>
							</ItemContent>
							<ItemActions className="self-start text-muted-foreground text-xs">
								{formatRelative(run.createdAt, now)}
							</ItemActions>
						</Item>
					))}
				</Lane>
			</div>

			<Card size="sm">
				<CardHeader>
					<CardTitle>Projects</CardTitle>
				</CardHeader>
				<CardContent>
					<ItemGroup className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
						{data.projects.map((project) => (
							<Item
								key={project.id}
								variant="outline"
								size="sm"
								render={linkTo(
									{
										to: "project",
										projectId: project.id,
										range,
										label: `the page of ${project.name}`,
									},
									sample,
								)}
							>
								<ItemContent>
									<ItemTitle>{project.name}</ItemTitle>
									<div className="text-sm">
										<LastRunsStrip
											runs={project.lastRuns.slice(0, 8)}
											now={now}
											linked={false}
										/>
									</div>
								</ItemContent>
								<ItemActions>
									<ChevronRightIcon className="size-4 text-muted-foreground" />
								</ItemActions>
							</Item>
						))}
					</ItemGroup>
				</CardContent>
			</Card>
			{details.dialog}
		</>
	);
}

/**
 * One lane: a fixed height, so the three line up, with its rows scrolling
 * inside, or an empty state in the middle.
 */
function Lane({
	icon,
	title,
	count,
	action,
	empty,
	children,
}: {
	icon: ReactNode;
	title: string;
	count: number;
	action?: ReactNode;
	empty: { icon: ReactNode; title: string; description: string };
	children: ReactNode[];
}) {
	return (
		<Card size="sm" className="h-[30rem] min-w-0">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 [&>svg]:size-4">
					{icon}
					{title}
					<Badge variant="secondary" className="tabular-nums">
						{count}
					</Badge>
				</CardTitle>
				{action ? <CardAction>{action}</CardAction> : null}
			</CardHeader>
			<CardContent className="min-h-0 flex-1 px-0">
				{children.length === 0 ? (
					<Empty className="h-full">
						<EmptyHeader>
							<EmptyMedia variant="icon">{empty.icon}</EmptyMedia>
							<EmptyTitle>{empty.title}</EmptyTitle>
							<EmptyDescription>{empty.description}</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<ScrollArea className="h-full px-3">
						<ItemGroup className="gap-2 pb-1">{children}</ItemGroup>
					</ScrollArea>
				)}
			</CardContent>
		</Card>
	);
}
