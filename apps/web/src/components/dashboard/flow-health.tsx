import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { Progress } from "@nightshift/ui/components/progress";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

import { RunStatusBadge } from "@/components/run-status-badge";
import { useNow } from "@/hooks/use-now";
import type { RunSummary } from "@/lib/api-types";
import { formatCost, formatDateTime, formatRelative } from "@/lib/format";
import { inLastNights } from "@/lib/nights";
import { orpc } from "@/utils/orpc";

const NIGHTS = 30;

/**
 * Each flow over the last 30 nights: its last run, how often it finished, and
 * what a run costs. A stopped run does not count against it: a person ended it.
 */
export function FlowHealth({
	projectId,
	runs,
}: {
	projectId: string;
	runs: RunSummary[] | undefined;
}) {
	const now = useNow(60_000);
	const flows = useQuery(
		orpc.flows.list.queryOptions({ input: { projectId } }),
	);

	if (!flows.isLoading && (flows.data?.length ?? 0) === 0) return null;

	return (
		<Card className="gap-0 pb-0">
			<CardHeader className="border-b pb-4 [.border-b]:pb-4">
				<CardTitle>
					<h2>Flow health</h2>
				</CardTitle>
				<CardDescription>
					Each flow over the last {NIGHTS} nights.
				</CardDescription>
				<CardAction>
					<Button
						variant="outline"
						size="sm"
						nativeButton={false}
						render={
							<Link to="/projects/$projectId/flows" params={{ projectId }} />
						}
					>
						Flows
						<ArrowRightIcon data-icon="inline-end" />
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent className="px-0">
				{flows.isLoading || !runs ? (
					<div className="flex flex-col gap-2 px-6 py-4">
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-9 w-full" />
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="pl-6">Flow</TableHead>
								<TableHead>Last run</TableHead>
								<TableHead className="w-48">Finished</TableHead>
								<TableHead className="text-right">Runs</TableHead>
								<TableHead className="pr-6 text-right">Per run</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{flows.data?.map((flow) => {
								const mine = runs.filter((run) => run.flowName === flow.name);
								const last = mine.reduce<RunSummary | undefined>(
									(latest, run) =>
										latest === undefined || run.createdAt > latest.createdAt
											? run
											: latest,
									undefined,
								);
								const recent = mine.filter((run) =>
									inLastNights(run.createdAt, NIGHTS, now),
								);
								const finished = recent.filter(
									(run) => run.status === "finished",
								).length;
								const ended = recent.filter(
									(run) =>
										run.status === "finished" ||
										run.status === "failed" ||
										run.status === "interrupted",
								).length;
								const rate =
									ended > 0 ? Math.round((finished / ended) * 100) : null;
								const cost = recent.reduce((sum, run) => sum + run.costUsd, 0);
								return (
									<TableRow key={flow.name}>
										<TableCell className="pl-6">
											<Link
												to="/projects/$projectId/flows/$name"
												params={{ projectId, name: flow.name }}
												className="font-medium font-mono text-xs underline-offset-4 hover:underline"
											>
												{flow.name}
											</Link>
										</TableCell>
										<TableCell>
											{last ? (
												<span className="flex items-center gap-2">
													<RunStatusBadge status={last.status} />
													<Link
														to="/runs/$runId"
														params={{ runId: last.id }}
														className="text-muted-foreground text-xs underline-offset-4 hover:underline"
													>
														<time
															dateTime={new Date(last.createdAt).toISOString()}
															title={formatDateTime(last.createdAt)}
														>
															{formatRelative(last.createdAt, now)}
														</time>
													</Link>
												</span>
											) : (
												<span className="text-muted-foreground text-xs">
													Never run
												</span>
											)}
										</TableCell>
										<TableCell>
											{rate === null ? (
												<span className="text-muted-foreground text-xs">—</span>
											) : (
												<span
													className="flex items-center gap-2"
													title={`${finished} of ${ended} finished; stopped runs left out`}
												>
													<Progress
														value={rate}
														aria-label={`${rate}% finished`}
														className="w-24"
													/>
													<span className="text-xs tabular-nums">{rate}%</span>
												</span>
											)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{recent.length}
										</TableCell>
										<TableCell className="pr-6 text-right tabular-nums">
											{recent.length > 0
												? formatCost(cost / recent.length)
												: "—"}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
