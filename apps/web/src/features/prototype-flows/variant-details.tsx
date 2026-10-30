/**
 * PROTOTYPE, throw away. Variant C: a narrow list of the flows on the left,
 * the chosen flow's details on the right: how its runs went, what starts
 * it, what it asks for and who runs it. You look before you act.
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
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@nightshift/ui/components/input-group";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Separator } from "@nightshift/ui/components/separator";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { PencilIcon, SearchIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { RunStatusIcon } from "@/features/runs";
import { formatCost, formatDateTime, formatRelative } from "@/shared/format";
import { FlowActions, NextStart, ProblemBadge, START_ICON } from "./flow-parts";
import { type FlowRow, START_LABEL, scheduleText } from "./flows-data";
import type { VariantProps } from "./flows-prototype";

export function VariantDetails(props: VariantProps) {
	const { rows } = props;
	const [query, setQuery] = useState("");
	const [chosen, setChosen] = useState<string | null>(null);

	if (!rows) return <Skeleton className="h-96 w-full rounded-xl" />;

	const needle = query.trim().toLowerCase();
	const shown = rows.filter(
		(row) => needle === "" || row.name.toLowerCase().includes(needle),
	);
	const selected =
		rows.find((row) => row.name === chosen) ?? shown[0] ?? rows[0] ?? null;

	return (
		<div className="grid items-start gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
			<Card size="sm" className="gap-2 lg:sticky lg:top-4">
				<CardContent className="flex flex-col gap-2 px-2">
					<InputGroup>
						<InputGroupAddon>
							<SearchIcon aria-hidden="true" />
						</InputGroupAddon>
						<InputGroupInput
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search flows"
							aria-label="Search flows"
						/>
					</InputGroup>
					<ItemGroup className="gap-0.5">
						{shown.map((row) => {
							const Icon = START_ICON[row.start];
							const last = row.health?.last;
							return (
								<Item
									key={row.name}
									size="xs"
									render={
										<button type="button" onClick={() => setChosen(row.name)} />
									}
									className={cn(
										"text-left hover:bg-muted",
										selected?.name === row.name && "bg-muted",
									)}
									aria-current={selected?.name === row.name || undefined}
								>
									<ItemContent className="min-w-0">
										<ItemTitle className="w-full truncate font-mono">
											{row.name}
										</ItemTitle>
										<ItemDescription className="flex items-center gap-1 text-xs">
											<Icon className="size-3" aria-hidden="true" />
											{START_LABEL[row.start]}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										{row.problem ? (
											<Badge
												variant={
													row.problem.kind === "broken"
														? "destructive"
														: "outline"
												}
												className="px-1.5"
											>
												!
											</Badge>
										) : last ? (
											<RunStatusIcon status={last.status} />
										) : null}
									</ItemActions>
								</Item>
							);
						})}
					</ItemGroup>
				</CardContent>
			</Card>
			{selected ? <Details row={selected} {...props} /> : null}
		</div>
	);
}

function Details({
	row,
	projectId,
	now,
	healthNights,
	onRun,
	onDelete,
}: VariantProps & { row: FlowRow }) {
	const health = row.health;
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 font-mono text-lg">
					{row.name}
					<ProblemBadge problem={row.problem} />
				</CardTitle>
				<CardDescription>
					{row.flow.description ?? "No description"}
				</CardDescription>
				<CardAction className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						nativeButton={false}
						render={
							<Link
								to="/projects/$projectId/flows/$name"
								params={{ projectId, name: row.name }}
							/>
						}
					>
						<PencilIcon data-icon="inline-start" />
						Edit
					</Button>
					<FlowActions
						projectId={projectId}
						row={row}
						onRun={() => onRun(row)}
						onDelete={() => onDelete(row)}
					/>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					<Stat
						label={`Runs, ${healthNights ?? "–"} nights`}
						value={health?.runs ?? 0}
					/>
					<Stat
						label="Finished"
						value={health?.rate === null || !health ? "—" : `${health.rate}%`}
					/>
					<Stat
						label="Per finished run"
						value={health?.cost ? formatCost(health.cost.median) : "—"}
					/>
					<Stat label="Nodes" value={row.flow.nodeCount ?? "—"} />
				</div>

				<Section title="Starts">
					{row.schedules.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							{row.start === "subflow" ? (
								<>
									Run by{" "}
									<span className="font-mono">
										{row.flow.callers.join(", ")}
									</span>
									.
								</>
							) : (
								"No schedule. It starts when you run it."
							)}
						</p>
					) : (
						<ItemGroup className="gap-1">
							{row.schedules.map((schedule) => (
								<Item key={schedule.id} size="xs" variant="outline">
									<ItemContent>
										<ItemTitle>{scheduleText(schedule)}</ItemTitle>
										<ItemDescription>
											{schedule.enabled ? (
												<NextStart schedule={schedule} now={now} />
											) : (
												"Paused"
											)}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Button
											variant="ghost"
											size="xs"
											nativeButton={false}
											render={
												<Link
													to="/projects/$projectId/schedules"
													params={{ projectId }}
												/>
											}
										>
											Edit
										</Button>
									</ItemActions>
								</Item>
							))}
						</ItemGroup>
					)}
				</Section>

				<Section title="Last runs">
					{!health?.lastRuns.length ? (
						<p className="text-muted-foreground text-sm">Never run.</p>
					) : (
						<ItemGroup className="gap-0">
							{health.lastRuns.map((run) => (
								<Item
									key={run.runId}
									size="xs"
									render={
										<Link to="/runs/$runId" params={{ runId: run.runId }} />
									}
								>
									<RunStatusIcon status={run.status} />
									<ItemContent>
										<ItemTitle className="font-normal">
											<time
												dateTime={new Date(run.startedAt).toISOString()}
												title={formatDateTime(run.startedAt)}
											>
												{formatRelative(run.startedAt, now)}
											</time>
										</ItemTitle>
									</ItemContent>
								</Item>
							))}
						</ItemGroup>
					)}
				</Section>

				{row.flow.inputs.length > 0 ? (
					<Section title="Asks for">
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
							{row.flow.inputs.map((input) => (
								<div key={input.name} className="contents">
									<dt className="font-mono">
										{input.name}
										{input.required ? "" : "?"}
									</dt>
									<dd className="text-muted-foreground">
										{input.description ?? input.label ?? "—"}
									</dd>
								</div>
							))}
						</dl>
					</Section>
				) : null}

				{row.flow.callers.length > 0 && row.schedules.length > 0 ? (
					<Section title="Run by">
						<p className="font-mono text-sm">{row.flow.callers.join(", ")}</p>
					</Section>
				) : null}
			</CardContent>
		</Card>
	);
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="flex flex-col gap-1 rounded-lg border p-3">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="font-medium text-xl tabular-nums">{value}</span>
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<h3 className="font-medium text-sm">{title}</h3>
			<Separator />
			{children}
		</section>
	);
}
