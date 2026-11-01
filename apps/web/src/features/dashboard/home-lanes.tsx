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
import type { ReactNode } from "react";
import type {
	NightRange,
	NightsRange,
	OpenGate,
	Project,
	RunSummary,
} from "@/shared/api";
import { formatRelative, formatTime, useNow } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { MoreRows } from "./details";

/**
 * Home's three lanes, in the order you act on them: what runs now, what
 * waits for you, what failed. Every row opens its place: a run its page,
 * a Gate its question in the inbox.
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
	failed: NightsRange["runs"]["failed"] | undefined;
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
				empty={{
					icon: <MoonIcon />,
					title: "Nothing runs now",
					description:
						"Start a flow from a project, or let its schedule start it tonight.",
				}}
			>
				{running.map((run) => {
					const project = projectName(run.projectId);
					return (
						<Item
							key={run.id}
							variant="outline"
							size="sm"
							render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
						>
							<ItemMedia variant="icon">
								{run.status === "sleeping" ? (
									<MoonIcon className="text-status-sleeping" />
								) : (
									<LoaderCircleIcon className="animate-spin text-status-running" />
								)}
							</ItemMedia>
							<ItemContent>
								<ItemTitle>
									{project ? `${project} · ${run.title}` : run.title}
								</ItemTitle>
								<ItemDescription>
									{run.status === "sleeping" && run.wakeAt ? (
										<>
											Continues at{" "}
											<LocalTime at={run.wakeAt}>
												{formatTime(run.wakeAt)}
											</LocalTime>
										</>
									) : (
										<>
											Started{" "}
											<LocalTime at={run.createdAt}>
												{formatRelative(run.createdAt, now)}
											</LocalTime>
										</>
									)}
								</ItemDescription>
							</ItemContent>
							<ItemActions>
								<ChevronRightIcon className="size-4 text-muted-foreground" />
							</ItemActions>
						</Item>
					);
				})}
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
				empty={{
					icon: <HourglassIcon />,
					title: "Nothing waits for you",
					description: "A run asks you here when it needs your decision.",
				}}
			>
				{gates.map((gate) => (
					<Item
						key={`${gate.runId}-${gate.stepId}`}
						variant="outline"
						size="sm"
						render={<Link to="/inbox" search={{ gate: gate.stepId }} />}
					>
						<ItemContent>
							<ItemTitle className="line-clamp-2">{gate.question}</ItemTitle>
							<ItemDescription>
								{gate.projectName} · {gate.flowName ?? gate.runTitle} · waits
								since{" "}
								<LocalTime at={gate.openedAt}>
									{formatRelative(gate.openedAt, now)}
								</LocalTime>
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
				count={failed?.count ?? 0}
				isLoading={!failed}
				action={
					failed && failed.count > 0 ? (
						<Button variant="ghost" size="sm" onClick={onFailedDetails}>
							Details
							<ArrowUpRightIcon data-icon="inline-end" />
						</Button>
					) : undefined
				}
				empty={{
					icon: <CircleCheckIcon />,
					title: "No run failed",
					description: `No run failed in the last ${range} nights.`,
				}}
				footer={
					failed ? (
						<MoreRows
							hidden={failed.count - failed.rows.length}
							where="in Details"
						/>
					) : null
				}
			>
				{(failed?.rows ?? []).map((run) => (
					<Item
						key={run.id}
						variant="outline"
						size="sm"
						render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
					>
						<ItemContent>
							<ItemTitle>
								{run.group} · {run.title}
							</ItemTitle>
							<ItemDescription className="line-clamp-2">
								{run.reason ?? "No reason given"}
							</ItemDescription>
						</ItemContent>
						<ItemActions className="self-start text-muted-foreground text-xs">
							<LocalTime at={run.createdAt}>
								{formatRelative(run.createdAt, now)}
							</LocalTime>
						</ItemActions>
					</Item>
				))}
			</Lane>
		</div>
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
	isLoading,
	action,
	empty,
	footer,
	children,
}: {
	icon: ReactNode;
	title: string;
	count: number;
	isLoading: boolean;
	action?: ReactNode;
	empty: { icon: ReactNode; title: string; description: string };
	footer?: ReactNode;
	children: ReactNode[];
}) {
	return (
		<Card size="sm" className="h-80 min-w-0 lg:h-[30rem]">
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
				{action ? <CardAction>{action}</CardAction> : null}
			</CardHeader>
			<CardContent className="flex min-h-0 flex-1 flex-col gap-2 px-0">
				{isLoading ? (
					<div className="flex flex-col gap-2 px-3">
						<Skeleton className="h-14 w-full" />
						<Skeleton className="h-14 w-full" />
					</div>
				) : children.length === 0 ? (
					<Empty className="h-full">
						<EmptyHeader>
							<EmptyMedia variant="icon">{empty.icon}</EmptyMedia>
							<EmptyTitle>{empty.title}</EmptyTitle>
							<EmptyDescription>{empty.description}</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<>
						<ScrollArea className="min-h-0 flex-1 px-3">
							<ItemGroup className="gap-2 pb-1">{children}</ItemGroup>
						</ScrollArea>
						{footer ? <div className="px-3">{footer}</div> : null}
					</>
				)}
			</CardContent>
		</Card>
	);
}
