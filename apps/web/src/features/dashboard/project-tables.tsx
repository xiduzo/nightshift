import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
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
import { ArrowRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { NightsRange, Project } from "@/shared/api";
import { formatCost, formatDateTime, formatDuration } from "@/shared/format";
import { FlowHealthTable } from "./flow-health";

type Tab = "flows" | "failures" | "gates" | "spend";

/**
 * The lists under the chart, over the page's range, one tab each: how the
 * flows do, the runs that failed, the Gates the flows asked and what they
 * spent. Each shows its top rows. The full list is one link away.
 */
export function ProjectTables({
	project,
	range,
}: {
	project: Project;
	/** Undefined while it loads. */
	range: NightsRange | undefined;
}) {
	const [tab, setTab] = useState<Tab>("flows");
	const failed = range?.runs.failed;

	return (
		<Card className="py-0">
			<CardContent className="px-0">
				<Tabs value={tab} onValueChange={(next) => setTab(next as Tab)}>
					<div className="flex items-center justify-between gap-2 px-4 pt-2">
						<TabsList variant="line">
							<TabsTrigger value="flows">Flows</TabsTrigger>
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
						<TabLink tab={tab} projectId={project.id} />
					</div>

					<TabsContent value="flows">
						<FlowHealthTable project={project} rows={range?.flows?.rows} />
					</TabsContent>

					<TabsContent value="failures">
						<SimpleTable
							head={["Run", "Why it failed", "Started"]}
							empty={`No run failed in the last ${range?.nights ?? ""} nights.`}
							rows={(failed?.rows ?? []).map((run) => [
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
						<SimpleTable
							head={["Flow", "Asked", "Answered", "Typical wait", "Longest"]}
							empty="No flow asked you anything in this range."
							rows={(range?.gates.groups.rows ?? []).map((group) => [
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
							head={["Flow", "Runs", "Spend"]}
							empty="Nothing spent in this range."
							rows={(range?.spend.groups ?? []).map((group) => [
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

/** The full list of the open tab, one link away. */
function TabLink({ tab, projectId }: { tab: Tab; projectId: string }) {
	const link =
		tab === "flows"
			? {
					label: "Flows",
					render: (
						<Link to="/projects/$projectId/flows" params={{ projectId }} />
					),
				}
			: tab === "gates"
				? { label: "Inbox", render: <Link to="/inbox" /> }
				: {
						label: "All runs",
						render: (
							<Link to="/projects/$projectId/runs" params={{ projectId }} />
						),
					};
	return (
		<Button variant="ghost" size="sm" nativeButton={false} render={link.render}>
			{link.label}
			<ArrowRightIcon data-icon="inline-end" />
		</Button>
	);
}

/** A small table: the first column leads, the others are numbers. */
function SimpleTable({
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
											: "text-right tabular-nums last:pr-6"
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
