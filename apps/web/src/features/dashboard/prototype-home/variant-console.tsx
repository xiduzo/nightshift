/**
 * PROTOTYPE, throw away. Home variant A, "Console": the project page as it
 * is, over every project. Tiles and chart on top, then tabs with Projects
 * first, where a flow row was on a project's page.
 */

import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nightshift/ui/components/tabs";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { NightRange } from "@/shared/api";
import {
	formatCost,
	formatDateTime,
	formatDuration,
	useNow,
} from "@/shared/format";
import { PageHeading } from "@/shared/page";
import { MetricTiles } from "../metric-tiles";
import { METRICS, type Metric } from "../metrics";
import { MetricsChart } from "../metrics-chart";
import { RangeBar } from "../range-bar";
import { changeOf, type ProjectNumbers, type useHomeData } from "./home-data";
import { HomeDetails, HomeNow, LastRunsStrip, lastRunsOf } from "./home-parts";

type Data = ReturnType<typeof useHomeData>;

export function VariantConsole({
	data,
	range,
	onRangeChange,
}: {
	data: Data;
	range: NightRange;
	onRangeChange: (range: NightRange) => void;
}) {
	const [on, setOn] = useState<Metric[]>(["runs", "finished"]);
	const [details, setDetails] = useState<{ metric: Metric; open: boolean }>();
	const { metrics } = data;

	return (
		<>
			<PageHeading
				title="Tonight"
				description="How your projects did, against the nights before."
			/>
			<RangeBar value={range} onValueChange={onRangeChange} />
			<HomeNow summary={data.summary} gates={data.gates} />
			<MetricTiles
				values={metrics?.values}
				before={metrics?.before}
				compared={metrics?.compared ?? false}
				on={on}
				onChange={setOn}
				onDetails={(metric) => setDetails({ metric, open: true })}
			/>
			<Card>
				<CardContent>
					{metrics ? (
						<MetricsChart
							rows={metrics.rows}
							on={on}
							compared={metrics.compared}
						/>
					) : (
						<Skeleton className="h-72 w-full" />
					)}
				</CardContent>
			</Card>
			<HomeTables data={data} />
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

type Tab = "projects" | "failures" | "gates" | "spend";

function HomeTables({ data }: { data: Data }) {
	const [tab, setTab] = useState<Tab>("projects");
	const now = useNow();
	const { nights } = data;
	const failed = nights?.runs.failed;

	return (
		<Card className="py-0">
			<CardContent className="px-0">
				<Tabs value={tab} onValueChange={(next) => setTab(next as Tab)}>
					<div className="flex items-center justify-between gap-2 px-4 pt-2">
						<TabsList variant="line">
							<TabsTrigger value="projects">Projects</TabsTrigger>
							<TabsTrigger value="failures">
								Failures
								{failed && failed.count > 0 ? (
									<Badge variant="secondary" className="tabular-nums">
										{failed.count}
									</Badge>
								) : null}
							</TabsTrigger>
							<TabsTrigger value="gates">Gates</TabsTrigger>
							<TabsTrigger value="spend">Spend</TabsTrigger>
						</TabsList>
						{tab === "gates" ? (
							<Button
								variant="ghost"
								size="sm"
								nativeButton={false}
								render={<Link to="/inbox" />}
							>
								Inbox
								<ArrowRightIcon data-icon="inline-end" />
							</Button>
						) : null}
					</div>

					<TabsContent value="projects">
						<SimpleTable
							head={["Project", "Last runs", "Runs", "Spend", "Gates asked"]}
							lead={2}
							empty="Add a project to see how it does."
							rows={data.perProject.map((row) => [
								<Link
									key="name"
									to="/projects/$projectId"
									params={{ projectId: row.project.id }}
									className="font-medium hover:underline"
								>
									{row.project.name}
								</Link>,
								<LastRunsStrip
									key="last"
									runs={lastRunsOf(row.nights)}
									now={now}
								/>,
								<NumberCell key="runs" row={row} metric="runs" />,
								<NumberCell key="spend" row={row} metric="spend" />,
								<NumberCell key="gates" row={row} metric="gates" />,
							])}
						/>
					</TabsContent>

					<TabsContent value="failures">
						<SimpleTable
							head={["Run", "Project", "Why it failed", "Started"]}
							empty={`No run failed in the last ${nights?.nights ?? ""} nights.`}
							rows={(failed?.rows ?? []).map((run) => [
								<Link
									key="title"
									to="/runs/$runId"
									params={{ runId: run.id }}
									className="font-medium hover:underline"
								>
									{run.title}
								</Link>,
								run.group,
								<span
									key="reason"
									className="line-clamp-2 text-left text-muted-foreground text-xs"
								>
									{run.reason ?? "No reason given"}
								</span>,
								formatDateTime(run.createdAt),
							])}
						/>
					</TabsContent>

					<TabsContent value="gates">
						<SimpleTable
							head={["Project", "Asked", "Answered", "Typical wait", "Longest"]}
							empty="No project asked you anything in this range."
							rows={(nights?.gates.groups.rows ?? []).map((group) => [
								group.label,
								group.asked,
								group.answered,
								group.typical === null ? "—" : formatDuration(group.typical),
								group.longest === null ? "—" : formatDuration(group.longest),
							])}
						/>
					</TabsContent>

					<TabsContent value="spend">
						<SimpleTable
							head={["Project", "Runs", "Spend"]}
							empty="Nothing spent in this range."
							rows={(nights?.spend.groups ?? []).map((group) => [
								group.label,
								group.runs,
								formatCost(group.total),
							])}
						/>
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
}

/** A project's number, and under it how it moved. Runs add the finished share. */
function NumberCell({ row, metric }: { row: ProjectNumbers; metric: Metric }) {
	const definition = METRICS.find((each) => each.key === metric);
	if (!row.metrics || !definition)
		return <Skeleton className="ml-auto h-8 w-16" />;
	const value = row.metrics.values[metric];
	const change = changeOf(
		metric,
		value,
		row.metrics.before[metric],
		row.metrics.compared,
	);
	return (
		<div className="flex flex-col items-end gap-0.5">
			<span className="text-sm">
				{definition.format(value)}
				{metric === "runs" && row.metrics.values.finished !== null ? (
					<span className="text-muted-foreground text-xs">
						{" "}
						· {row.metrics.values.finished}% finished
					</span>
				) : null}
			</span>
			<span className="flex items-center gap-1 text-muted-foreground text-xs [&_svg]:size-3">
				{change.icon}
				{change.short}
			</span>
		</div>
	);
}

/** A small table: the first `lead` columns read as text, the rest as numbers. */
function SimpleTable({
	head,
	rows,
	empty,
	lead = 1,
}: {
	head: string[];
	rows: ReactNode[][];
	empty: string;
	lead?: number;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					{head.map((label, index) => (
						<TableHead
							key={label}
							className={
								index === 0
									? "pl-6"
									: index < lead
										? ""
										: "text-right last:pr-6"
							}
						>
							{label}
						</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.length === 0 ? (
					<TableRow>
						<TableCell
							colSpan={head.length}
							className="py-6 text-center text-muted-foreground"
						>
							{empty}
						</TableCell>
					</TableRow>
				) : (
					rows.map((cells, row) => (
						<TableRow key={row}>
							{cells.map((cell, index) => (
								<TableCell
									key={index}
									className={
										index === 0
											? "max-w-md pl-6"
											: index < lead
												? ""
												: "text-right tabular-nums last:pr-6 [&>div]:items-end"
									}
								>
									{cell}
								</TableCell>
							))}
						</TableRow>
					))
				)}
			</TableBody>
		</Table>
	);
}
