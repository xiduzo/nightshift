import { shortReason } from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
} from "@nightshift/ui/components/empty";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@nightshift/ui/components/hover-card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	ArrowUpRightIcon,
	ChevronRightIcon,
	CircleCheckIcon,
	CircleXIcon,
	HourglassIcon,
	LoaderCircleIcon,
	MoonIcon,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type {
	FailingFlow,
	NightRange,
	NightsRange,
	OpenGate,
	Project,
	RunSummary,
} from "@/shared/api";
import { formatRelative, formatTime, useNow } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { OVERVIEW_ROWS } from "./overview";

/**
 * Home's three lanes, in the order you act on them: what runs now, what
 * waits for you, which flows failed. The lanes share the height of the
 * tallest. A row is one line and shows the rest on hover. Every row opens
 * its place: a run its page, a Gate its question in the inbox.
 */
export function HomeLanes({
	running,
	gates,
	failed,
	projects,
	range,
	isLoading,
	onFailedDetails,
}: {
	/** The runs at work or asleep now. */
	running: RunSummary[];
	gates: OpenGate[];
	/** Undefined while the numbers load. */
	failed: NightsRange["runs"] | undefined;
	projects: Project[] | undefined;
	range: NightRange;
	isLoading: boolean;
	onFailedDetails: () => void;
}) {
	const now = useNow();
	const projectName = (projectId: string) =>
		projects?.find((project) => project.id === projectId)?.name;

	return (
		<div className="grid gap-4 lg:grid-cols-3">
			<Lane
				icon={<LoaderCircleIcon className="text-status-running" />}
				title="Running now"
				count={running.length}
				isLoading={isLoading}
				empty="Nothing runs now. A schedule starts its flow at its time."
			>
				{running.map((run) => (
					<LaneRow
						key={run.id}
						link={<Link to="/runs/$runId" params={{ runId: run.id }} />}
						icon={
							run.status === "sleeping" ? (
								<MoonIcon className="text-status-sleeping" />
							) : (
								<LoaderCircleIcon className="animate-spin text-status-running" />
							)
						}
						title={
							<Title group={projectName(run.projectId)} name={run.title} />
						}
						meta={
							run.status === "sleeping" && run.wakeAt ? (
								<LocalTime at={run.wakeAt}>
									Continues at {formatTime(run.wakeAt)}
								</LocalTime>
							) : (
								<LocalTime at={run.createdAt}>
									{formatRelative(run.createdAt, now)}
								</LocalTime>
							)
						}
					/>
				))}
			</Lane>

			<Lane
				icon={<HourglassIcon className="text-status-waiting" />}
				title="Waiting for you"
				count={gates.length}
				isLoading={isLoading}
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
				empty="Nothing waits for you."
				hidden={gates.length - OVERVIEW_ROWS}
				where="in the inbox"
			>
				{gates.slice(0, OVERVIEW_ROWS).map((gate) => (
					<LaneRow
						key={`${gate.runId}-${gate.stepId}`}
						link={<Link to="/inbox" search={{ gate: gate.stepId }} />}
						title={<span className="truncate">{gate.question}</span>}
						meta={
							<LocalTime at={gate.openedAt}>
								{formatRelative(gate.openedAt, now)}
							</LocalTime>
						}
						detail={
							<>
								<p className="font-medium">{gate.question}</p>
								<p className="text-muted-foreground">
									{gate.projectName} · {gate.flowName ?? gate.runTitle}
								</p>
							</>
						}
					/>
				))}
			</Lane>

			<Lane
				icon={<CircleXIcon className="text-status-failed" />}
				title="Failed"
				count={failed?.stillFailing ?? 0}
				isLoading={!failed}
				action={
					<Button variant="ghost" size="sm" onClick={onFailedDetails}>
						Details
						<ArrowUpRightIcon data-icon="inline-end" />
					</Button>
				}
				empty={`No run failed in the last ${range} nights.`}
				hidden={failed ? failed.failing.count - failed.failing.rows.length : 0}
				where="in Details"
			>
				{(failed?.failing.rows ?? []).map((flow) => (
					<FailedRow key={flow.key} flow={flow} now={now} />
				))}
			</Lane>
		</div>
	);
}

/** A flow with failed runs. A flow that a later run finished shows dimmed. */
function FailedRow({ flow, now }: { flow: FailingFlow; now: number }) {
	const { step, short } = shortReason(flow.reason);
	const times =
		flow.failed === 1 ? "Failed once" : `Failed ${flow.failed} times`;
	return (
		<LaneRow
			link={<Link to="/runs/$runId" params={{ runId: flow.runId }} />}
			muted={flow.fixedAt !== null}
			title={<Title group={flow.group} name={flow.title} />}
			meta={
				flow.fixedAt !== null ? (
					<CircleCheckIcon
						className="size-3.5 text-status-finished"
						aria-label="A later run finished"
					/>
				) : flow.failed > 1 ? (
					`${flow.failed}×`
				) : (
					<LocalTime at={flow.lastAt}>
						{formatRelative(flow.lastAt, now)}
					</LocalTime>
				)
			}
			detail={
				<>
					<p className="font-medium">{step ? `${times}, at ${step}` : times}</p>
					<p className="text-muted-foreground">{short ?? "No reason given."}</p>
					<p className="text-muted-foreground text-xs">
						Last failed{" "}
						<LocalTime at={flow.lastAt}>
							{formatRelative(flow.lastAt, now)}
						</LocalTime>
					</p>
					{flow.fixedAt !== null ? (
						<Badge variant="outline" className="text-status-finished">
							<CircleCheckIcon data-icon="inline-start" />A later run finished{" "}
							{formatRelative(flow.fixedAt, now)}
						</Badge>
					) : null}
				</>
			}
		/>
	);
}

/** "project · flow": the flow truncates first. */
function Title({ group, name }: { group: string | undefined; name: string }) {
	return (
		<span className="flex min-w-0 gap-1">
			{group ? (
				<span className="shrink-0 text-muted-foreground">{group} ·</span>
			) : null}
			<span className="truncate">{name}</span>
		</span>
	);
}

/** One line of a lane. With `detail`, the rest shows on hover. */
function LaneRow({
	link,
	icon,
	title,
	meta,
	detail,
	muted,
}: {
	link: ReactElement;
	icon?: ReactNode;
	title: ReactNode;
	meta: ReactNode;
	detail?: ReactNode;
	muted?: boolean;
}) {
	const body = (
		<>
			{icon ? <ItemMedia variant="icon">{icon}</ItemMedia> : null}
			<ItemContent className="min-w-0">
				<ItemTitle className="w-full font-normal">{title}</ItemTitle>
			</ItemContent>
			<ItemActions className="text-muted-foreground text-xs tabular-nums">
				{meta}
				<ChevronRightIcon className="size-3.5" />
			</ItemActions>
		</>
	);
	const className = muted ? "opacity-60" : undefined;
	if (!detail) {
		return (
			<Item size="xs" className={className} render={link}>
				{body}
			</Item>
		);
	}
	return (
		<HoverCard>
			<HoverCardTrigger
				render={<Item size="xs" className={className} render={link} />}
			>
				{body}
			</HoverCardTrigger>
			<HoverCardContent className="flex w-96 flex-col gap-1.5 text-sm">
				{detail}
			</HoverCardContent>
		</HoverCard>
	);
}

/**
 * One lane: as tall as its row of lanes, one line when it has none, and how many
 * rows it leaves out under them.
 */
function Lane({
	icon,
	title,
	count,
	isLoading,
	action,
	empty,
	hidden = 0,
	where,
	children,
}: {
	icon: ReactNode;
	title: string;
	count: number;
	isLoading: boolean;
	action?: ReactNode;
	empty: string;
	hidden?: number;
	where?: string;
	children: ReactNode[];
}) {
	return (
		<Card size="sm" className="min-w-0">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 [&>svg]:size-4">
					{icon}
					{title}
					{isLoading ? null : (
						<Badge variant="secondary" className="tabular-nums">
							{count}
						</Badge>
					)}
				</CardTitle>
				{action && children.length > 0 ? (
					<CardAction>{action}</CardAction>
				) : null}
			</CardHeader>
			<CardContent className="flex-1 px-2">
				{isLoading ? (
					<div className="flex flex-col gap-2 px-2">
						<Skeleton className="h-7 w-full" />
						<Skeleton className="h-7 w-full" />
					</div>
				) : children.length === 0 ? (
					<Empty className="items-start p-2 md:p-2">
						<EmptyHeader className="items-start text-left">
							<EmptyDescription>{empty}</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<ItemGroup>{children}</ItemGroup>
				)}
			</CardContent>
			{hidden > 0 && !isLoading ? (
				<CardFooter className="text-muted-foreground text-xs">
					{hidden} more {where}.
				</CardFooter>
			) : null}
		</Card>
	);
}
