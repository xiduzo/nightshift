import {
	againstBefore,
	daysOf,
	signalId,
	signalTitle,
	type WatchedFlow,
} from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemSeparator,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CheckIcon,
	ChevronDownIcon,
	CircleCheckIcon,
	FileTextIcon,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { SetupCard } from "@/features/agents";
import { projectQueries } from "@/features/projects";
import { ReportPreview, reportLink } from "@/features/runs";
import type { FlowReport } from "@/shared/api";
import { formatRelative, formatTime, useNow } from "@/shared/format";
import { PageSection, SiteHeader } from "@/shared/page";
import { LocalTime } from "@/shared/time";
import { useLastLook } from "./last-look";
import { LookSheet } from "./look-sheet";
import { dashboardQueries } from "./queries";
import { SignalIcon, WeekBars } from "./watch-parts";

/** The days of the reports Home shows. */
const REPORT_DAYS = 7;

/**
 * Home: a note over every project, read top to bottom. It guards the
 * flows that nobody watches. First the flows that left their usual range
 * (Needs a look), then what came out. A flow stays under Needs a look
 * until it is back in its range, or until you say you looked at it. What
 * is new since your last look says so. Before an agent is ready, Get
 * started sits on top.
 */
export function HomePage() {
	const now = useNow(60_000);
	const summary = useQuery(dashboardQueries.summary());
	const projects = useQuery(projectQueries.list());
	const watch = summary.data?.watch;
	// The flow stays while the Sheet closes, so its body does not go blank.
	const [sheet, setSheet] = useState<{ key: string; open: boolean }>();

	const showing = useMemo(
		() =>
			watch?.flows.flatMap((flow) =>
				flow.signals.map((signal) => ({
					id: signalId(flow.key, signal),
					key: flow.key,
					flow: flow.flow,
				})),
			),
		[watch],
	);
	const { before, looked, look, again } = useLastLook(showing);

	const projectName = (projectId: string) =>
		projects.data?.find((project) => project.id === projectId)?.name;
	const idsOf = (flow: WatchedFlow) =>
		flow.signals.map((signal) => signalId(flow.key, signal));
	// A flow is looked at when you looked at each of its signals.
	const isLooked = (flow: WatchedFlow) =>
		idsOf(flow).every((id) => looked[id] !== undefined);
	const isNew = (flow: WatchedFlow) =>
		before !== null &&
		idsOf(flow).some((id) => !before.shown.some((shown) => shown.id === id));
	const open = watch?.flows.filter((flow) => !isLooked(flow)) ?? [];
	const lookedAt = watch?.flows.filter(isLooked) ?? [];
	const fresh = open.filter(isNew).length;
	// The flows that showed at your last look and show no more.
	const back = [
		...new Map(
			(before?.shown ?? [])
				.filter(
					(shown) =>
						showing !== undefined &&
						!showing.some((signal) => signal.key === shown.key),
				)
				.map((shown) => [shown.key, shown.flow]),
		),
	];

	const reports = summary.data
		? (daysOf(summary.data, REPORT_DAYS)?.reports?.rows ?? [])
		: undefined;
	const newReports = (reports ?? []).filter(
		(report) => before === null || report.endedAt > before.at,
	);
	const oldReports = (reports ?? []).filter(
		(report) => before !== null && report.endedAt <= before.at,
	);
	const week = watch?.perWeek.at(-1) ?? 0;
	const lastWeek = watch?.perWeek.at(-2) ?? 0;
	const sheetFlow = watch?.flows.find((flow) => flow.key === sheet?.key);

	return (
		<>
			<SiteHeader crumbs={[{ label: "Home" }]} />
			<div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 p-4 py-10 md:p-6 md:py-14">
				<header className="flex flex-col gap-3">
					{before ? (
						<p className="text-muted-foreground text-sm">
							Since you last looked,{" "}
							<LocalTime at={before.at}>
								{formatRelative(before.at, now)}
							</LocalTime>
						</p>
					) : null}
					{summary.isLoading ? (
						<Skeleton className="h-9 w-80 max-w-full" />
					) : (
						<h1 className="text-balance font-semibold text-3xl tracking-tight">
							{headline(open.length, fresh, before !== null)}
						</h1>
					)}
					{watch ? (
						<div className="flex items-end gap-4">
							<p className="flex-1 text-lg text-muted-foreground">
								{week === 0
									? "No flow needed you without a plan this week."
									: `This week your flows needed you ${week} ${week === 1 ? "time" : "times"} without a plan.`}{" "}
								That is {againstBefore(week, lastWeek, "week")}.
							</p>
							<WeekBars weeks={watch.perWeek} className="h-10 w-32" />
						</div>
					) : null}
				</header>

				<SetupCard />

				{summary.data && !watch ? (
					<p className="text-muted-foreground text-sm">
						Update Night Shift on the computer that runs your flows. Then Home
						shows the flows that need a look.
					</p>
				) : null}

				{watch && watch.flows.length === 0 && back.length === 0 ? (
					<Item variant="muted">
						<ItemMedia variant="icon">
							<CircleCheckIcon className="text-status-finished" />
						</ItemMedia>
						<ItemContent>
							<ItemTitle>Nothing needs a look</ItemTitle>
							<ItemDescription>
								{watch.watched === 0
									? "Night Shift watches a flow from its first runs. Start a flow, or give one a schedule."
									: "Each flow finished its runs and stayed in its usual range."}
							</ItemDescription>
						</ItemContent>
					</Item>
				) : watch ? (
					<PageSection title="Needs a look">
						{open.length > 0 ? (
							<ItemGroup className="rounded-xl border">
								{open.map((flow, index) => (
									<Fragment key={flow.key}>
										{index > 0 ? <ItemSeparator /> : null}
										<Item>
											<ItemMedia>
												{flow.signals[0] ? (
													<SignalIcon signal={flow.signals[0]} />
												) : null}
											</ItemMedia>
											<ItemContent>
												<ItemTitle>
													{flow.flow}
													<span className="font-normal text-muted-foreground">
														{projectName(flow.projectId)}
													</span>
													{isNew(flow) ? <Badge>New</Badge> : null}
												</ItemTitle>
												{flow.signals.map((signal) => (
													<ItemDescription
														key={signal.kind}
														className="text-foreground"
													>
														{signalTitle(signal)}
													</ItemDescription>
												))}
											</ItemContent>
											<ItemActions>
												<Button
													size="sm"
													variant="outline"
													onClick={() =>
														setSheet({ key: flow.key, open: true })
													}
												>
													Look
												</Button>
											</ItemActions>
										</Item>
									</Fragment>
								))}
							</ItemGroup>
						) : null}
						{back.map(([key, name]) => (
							<p
								key={key}
								className="flex items-center gap-2 px-1 text-muted-foreground text-sm"
							>
								<CircleCheckIcon
									className="size-4 text-status-finished"
									aria-hidden="true"
								/>
								<span>
									<span className="text-foreground">{name}</span> is back to
									normal.
								</span>
							</p>
						))}
						{lookedAt.map((flow) => (
							<p
								key={flow.key}
								className="flex items-center gap-2 px-1 text-muted-foreground text-sm"
							>
								<CheckIcon className="size-4" aria-hidden="true" />
								<span className="flex-1">
									You looked at{" "}
									<span className="text-foreground">{flow.flow}</span> at{" "}
									{formatTime(
										Math.max(...idsOf(flow).map((id) => looked[id] ?? 0)),
									)}
									. It comes back here when it changes.
								</span>
								<Button
									size="xs"
									variant="ghost"
									onClick={() => {
										for (const id of idsOf(flow)) again(id);
										setSheet({ key: flow.key, open: true });
									}}
								>
									Look again
								</Button>
							</p>
						))}
					</PageSection>
				) : null}

				{reports === undefined || reports.length > 0 ? (
					<PageSection title="What came out">
						{reports === undefined ? (
							<Skeleton className="h-24 w-full" />
						) : (
							<>
								<ItemGroup>
									{newReports.map((report) => (
										<ReportItem
											key={report.key}
											report={report}
											now={now}
											project={projectNameOf(report, projectName)}
											isNew={before !== null}
										/>
									))}
								</ItemGroup>
								{newReports.length === 0 ? (
									<p className="px-1 text-muted-foreground text-sm">
										No new report since you last looked.
									</p>
								) : null}
								{oldReports.length > 0 ? (
									<Collapsible>
										<CollapsibleTrigger
											render={
												<Button
													variant="ghost"
													size="sm"
													className="text-muted-foreground"
												/>
											}
										>
											<ChevronDownIcon data-icon="inline-start" />
											{oldReports.length} from before your last look
										</CollapsibleTrigger>
										<CollapsibleContent>
											<ItemGroup>
												{oldReports.map((report) => (
													<ReportItem
														key={report.key}
														report={report}
														now={now}
														project={projectNameOf(report, projectName)}
													/>
												))}
											</ItemGroup>
										</CollapsibleContent>
									</Collapsible>
								) : null}
							</>
						)}
					</PageSection>
				) : null}
			</div>

			<LookSheet
				flow={sheetFlow}
				projectName={sheetFlow ? projectName(sheetFlow.projectId) : undefined}
				open={sheet?.open ?? false}
				onOpenChange={(next) => sheet && setSheet({ ...sheet, open: next })}
				onLooked={() => {
					if (!sheetFlow || !sheet) return;
					for (const id of idsOf(sheetFlow)) look(id);
					setSheet({ ...sheet, open: false });
				}}
			/>
		</>
	);
}

/** The heading: how many flows need a look, and how many of them are new. */
function headline(open: number, fresh: number, cameBack: boolean): string {
	if (open === 0) return "Every flow did its work.";
	const need = (count: number) => (count === 1 ? "flow needs" : "flows need");
	if (!cameBack || fresh === open) {
		return `${open} ${need(open)} a look.`;
	}
	const still = open - fresh;
	return `${fresh === 0 ? "No" : fresh} new ${need(fresh)} a look. ${still} still ${still === 1 ? "does" : "do"}.`;
}

/** The project of a report: over all projects its group is the project's name. */
function projectNameOf(
	report: FlowReport,
	projectName: (projectId: string) => string | undefined,
): string {
	return projectName(report.key.split("/")[0] ?? "") ?? report.group;
}

/** One report: its flow, when its run ended, and the start of its text. It opens the run at the report. */
function ReportItem({
	report,
	now,
	project,
	isNew = false,
}: {
	report: FlowReport;
	now: number;
	project: string;
	isNew?: boolean;
}) {
	return (
		<Item size="sm" render={<Link {...reportLink(report)} />}>
			<ItemMedia>
				<FileTextIcon
					className="size-4 text-muted-foreground"
					aria-hidden="true"
				/>
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					{report.title}
					<span className="font-normal text-muted-foreground">
						{project} ·{" "}
						<LocalTime at={report.endedAt}>
							{formatRelative(report.endedAt, now)}
						</LocalTime>
					</span>
					{isNew ? <Badge variant="secondary">New</Badge> : null}
				</ItemTitle>
				<ReportPreview text={report.excerpt} more={report.more} plain />
			</ItemContent>
		</Item>
	);
}
