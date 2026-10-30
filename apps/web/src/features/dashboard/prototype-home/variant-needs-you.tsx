/**
 * PROTOTYPE, throw away. Home variant C, "Needs you first": Home as a
 * to-do. The wide column lists what waits for you and what failed, grouped
 * by project. The numbers move to a rail on the right: the range, the four
 * metrics as small lines, and the projects.
 */

import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, CircleXIcon, HourglassIcon } from "lucide-react";
import { useState } from "react";
import type { NightRange, NightsRange } from "@/shared/api";
import { formatRelative, useNow } from "@/shared/format";
import { PageHeading } from "@/shared/page";
import { METRICS, type Metric } from "../metrics";
import { RangeBar } from "../range-bar";
import { changeOf, Sparkline, type useHomeData } from "./home-data";
import { HomeDetails, LastRunsStrip, lastRunsOf } from "./home-parts";

type Data = ReturnType<typeof useHomeData>;
type DashboardRun = NightsRange["runs"]["failed"]["rows"][number];

export function VariantNeedsYou({
	data,
	range,
	onRangeChange,
}: {
	data: Data;
	range: NightRange;
	onRangeChange: (range: NightRange) => void;
}) {
	const now = useNow();
	const [details, setDetails] = useState<{ metric: Metric; open: boolean }>();
	const { metrics, nights } = data;
	const failed = nights?.runs.failed;
	const running = data.summary?.cards.running ?? 0;

	// The failed runs per project, the project with the most first.
	const byProject = new Map<string, DashboardRun[]>();
	for (const run of failed?.rows ?? []) {
		byProject.set(run.group, [...(byProject.get(run.group) ?? []), run]);
	}
	const failedGroups = [...byProject].sort((a, b) => b[1].length - a[1].length);

	return (
		<>
			<PageHeading
				title="Tonight"
				description={
					data.gates.length + (failed?.count ?? 0) === 0
						? "Nothing needs you. Your projects ran without trouble."
						: "What needs you first, then how your projects did."
				}
			/>
			<div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
				<div className="flex flex-col gap-6">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<HourglassIcon className="size-4 text-status-waiting" />
								Waiting for you
							</CardTitle>
							<CardDescription>
								{running > 0 ? `${running} running now. ` : ""}
								Runs pause here until you answer.
							</CardDescription>
							<CardAction>
								<Button
									variant="ghost"
									size="sm"
									nativeButton={false}
									render={<Link to="/inbox" />}
								>
									Inbox
									<ArrowRightIcon data-icon="inline-end" />
								</Button>
							</CardAction>
						</CardHeader>
						<CardContent>
							{data.gates.length === 0 ? (
								<Empty className="py-6">
									<EmptyHeader>
										<EmptyTitle>Nothing waits for you</EmptyTitle>
										<EmptyDescription>
											A Gate shows up here when a run asks you something.
										</EmptyDescription>
									</EmptyHeader>
								</Empty>
							) : (
								<ItemGroup className="gap-2">
									{data.gates.map((gate) => (
										<Item
											key={`${gate.runId}-${gate.stepId}`}
											variant="outline"
											size="sm"
											render={<Link to="/inbox" />}
										>
											<ItemContent>
												<ItemTitle>{gate.question}</ItemTitle>
												<ItemDescription>
													{gate.projectName} · {gate.runTitle} · waits since{" "}
													{formatRelative(gate.openedAt, now)}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<ArrowRightIcon className="size-4" />
											</ItemActions>
										</Item>
									))}
								</ItemGroup>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<CircleXIcon className="size-4 text-status-failed" />
								Failed in the last {range} nights
								{failed && failed.count > 0 ? (
									<Badge variant="secondary">{failed.count}</Badge>
								) : null}
							</CardTitle>
							<CardDescription>
								Grouped by project, the newest first.
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							{failedGroups.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									No run failed in these nights.
								</p>
							) : (
								failedGroups.map(([project, runs]) => (
									<div key={project} className="flex flex-col gap-2">
										<p className="font-medium text-sm">
											{project}{" "}
											<span className="text-muted-foreground">
												· {runs.length} failed
											</span>
										</p>
										<ItemGroup className="gap-1">
											{runs.slice(0, 4).map((run) => (
												<Item
													key={run.id}
													size="sm"
													render={
														<Link
															to="/runs/$runId"
															params={{ runId: run.id }}
														/>
													}
												>
													<ItemContent>
														<ItemTitle>{run.title}</ItemTitle>
														<ItemDescription>
															{run.reason ?? "No reason given"}
														</ItemDescription>
													</ItemContent>
													<ItemActions className="text-muted-foreground text-xs">
														{formatRelative(run.createdAt, now)}
													</ItemActions>
												</Item>
											))}
										</ItemGroup>
									</div>
								))
							)}
						</CardContent>
					</Card>
				</div>

				{/* The rail: the range, the numbers as small lines, the projects. */}
				<div className="flex flex-col gap-4 lg:sticky lg:top-4">
					<RangeBar value={range} onValueChange={onRangeChange} />
					<Card className="gap-0 py-0">
						{METRICS.map((each) => {
							const change = metrics
								? changeOf(
										each.key,
										metrics.values[each.key],
										metrics.before[each.key],
										metrics.compared,
									)
								: undefined;
							return (
								<button
									key={each.key}
									type="button"
									onClick={() => setDetails({ metric: each.key, open: true })}
									className="grid grid-cols-[1fr_96px] items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/50"
								>
									<span className="flex flex-col">
										<span className="text-muted-foreground text-xs">
											{each.label}
										</span>
										<span className="font-semibold text-xl tabular-nums">
											{metrics ? each.format(metrics.values[each.key]) : "…"}
										</span>
										{change ? (
											<span className="flex items-center gap-1 text-muted-foreground text-xs [&_svg]:size-3">
												{change.icon}
												{change.short}
											</span>
										) : null}
									</span>
									{metrics ? (
										<Sparkline
											rows={metrics.rows}
											metric={each.key}
											color={each.color}
											compared={metrics.compared}
										/>
									) : null}
								</button>
							);
						})}
					</Card>
					<Card size="sm">
						<CardHeader>
							<CardTitle>Projects</CardTitle>
						</CardHeader>
						<CardContent>
							<ItemGroup className="gap-1">
								{data.perProject.map((row) => (
									<Item key={row.project.id} size="sm">
										<ItemContent>
											<ItemTitle>
												<Link
													to="/projects/$projectId"
													params={{ projectId: row.project.id }}
													search={{ range }}
													className="hover:underline"
												>
													{row.project.name}
												</Link>
											</ItemTitle>
											<div className="text-sm">
												<LastRunsStrip
													runs={lastRunsOf(row.nights, 8)}
													now={now}
												/>
											</div>
										</ItemContent>
									</Item>
								))}
							</ItemGroup>
						</CardContent>
					</Card>
				</div>
			</div>

			{data.summary && details ? (
				<HomeDetails
					metric={details.metric}
					open={details.open}
					onOpenChange={(open) => setDetails({ ...details, open })}
					summary={data.summary}
					range={range}
					gates={data.gates}
				/>
			) : null}
		</>
	);
}
