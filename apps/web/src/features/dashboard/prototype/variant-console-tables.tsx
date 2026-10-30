/**
 * PROTOTYPE, throw away. The tabbed table under the Console chart: flows,
 * failures, Gates, spend and busy hours, each over the page-wide range where
 * the numbers have it.
 */

import { Card, CardContent } from "@nightshift/ui/components/card";
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
import type { ReactNode } from "react";
import type { DashboardSummary, Project } from "@/shared/api";
import {
	formatCost,
	formatDateTime,
	formatDuration,
	useNow,
} from "@/shared/format";
import { hoursOf, nightsOf } from "../ranges";
import type { DashboardRange } from "./range-bar";
import { ConsoleFlows } from "./variant-console-flows";

const DAY_MS = 24 * 60 * 60_000;

export function ConsoleTables({
	project,
	summary,
	range,
}: {
	project: Project;
	summary: DashboardSummary | undefined;
	range: DashboardRange;
}) {
	const now = useNow(60_000);
	if (!summary) return null;

	// The lists of the last day come from the 7 nights, cut to 24 hours.
	const nights = nightsOf(summary, range === "24h" ? 7 : range);
	const since = range === "24h" ? now - DAY_MS : 0;
	const failed = nights.runs.failed.rows.filter(
		(run) => run.createdAt >= since,
	);
	const priciest = nights.spend.priciest.filter(
		(run) => run.createdAt >= since,
	);
	const hours = hoursOf(summary, range === "24h" ? 24 : 168);

	return (
		<Card className="py-0">
			<CardContent className="px-0">
				<Tabs defaultValue="flows">
					<TabsList variant="line" className="px-4 pt-2">
						<TabsTrigger value="flows">Flows</TabsTrigger>
						<TabsTrigger value="failures">
							Failures {failed.length > 0 ? `(${failed.length})` : ""}
						</TabsTrigger>
						<TabsTrigger value="gates">Gates</TabsTrigger>
						<TabsTrigger value="spend">Spend</TabsTrigger>
						<TabsTrigger value="hours">Busy hours</TabsTrigger>
					</TabsList>

					<TabsContent value="flows">
						<ConsoleFlows project={project} summary={summary} range={range} />
					</TabsContent>

					<TabsContent value="failures">
						<ConsoleTable
							head={["Run", "Why it failed", "Started"]}
							empty="No run failed in this range."
							rows={failed.map((run) => [
								<Link
									key="title"
									to="/runs/$runId"
									params={{ runId: run.id }}
									className="font-medium hover:underline"
								>
									{run.title}
								</Link>,
								<span
									key="reason"
									className="line-clamp-2 text-muted-foreground text-xs"
								>
									{run.reason ?? "No reason given"}
								</span>,
								formatDateTime(run.createdAt),
							])}
						/>
					</TabsContent>

					<TabsContent value="gates">
						<Note>
							{range === "24h" ? "Gates count the last 7 nights." : null}
						</Note>
						<ConsoleTable
							head={["Flow", "Asked", "Answered", "Typical wait", "Longest"]}
							empty="No Gate asked anything in this range."
							rows={nights.gates.groups.rows.map((group) => [
								group.label,
								group.asked,
								group.answered,
								group.typical === null ? "—" : formatDuration(group.typical),
								group.longest === null ? "—" : formatDuration(group.longest),
							])}
						/>
					</TabsContent>

					<TabsContent value="spend">
						<Note>
							{range === "24h"
								? "Flows count the last 7 nights. The runs count the last 24 hours."
								: null}
						</Note>
						<ConsoleTable
							head={["Flow", "Runs", "Spend"]}
							empty="Nothing spent in this range."
							rows={nights.spend.groups.map((group) => [
								group.label,
								group.runs,
								formatCost(group.total),
							])}
						/>
						<ConsoleTable
							head={["Priciest runs", "Started", "Spend"]}
							empty="No run cost anything."
							rows={priciest.map((run) => [
								<Link
									key="title"
									to="/runs/$runId"
									params={{ runId: run.id }}
									className="hover:underline"
								>
									{run.title}
								</Link>,
								formatDateTime(run.createdAt),
								formatCost(run.costUsd),
							])}
						/>
					</TabsContent>

					<TabsContent value="hours">
						<Note>
							{`Peak: ${hours.peak} runs at once, over the last ${hours.hours} hours.`}
						</Note>
						<ConsoleTable
							head={["Flow", "Runs", "Started", "At work", "Longest"]}
							empty="Nothing ran in this range."
							rows={hours.groups.rows.map((group) => [
								group.label,
								group.runs,
								group.started,
								formatDuration(group.atWork),
								formatDuration(group.longest),
							])}
						/>
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
}

function Note({ children }: { children: ReactNode }) {
	if (!children) return null;
	return <p className="px-6 pt-2 text-muted-foreground text-xs">{children}</p>;
}

function ConsoleTable({
	head,
	rows,
	empty,
}: {
	head: string[];
	rows: ReactNode[][];
	empty: string;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					{head.map((label, index) => (
						<TableHead
							key={label}
							className={index === 0 ? "pl-6" : "text-right last:pr-6"}
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
											: "text-right tabular-nums last:pr-6 [&>span]:justify-end"
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
