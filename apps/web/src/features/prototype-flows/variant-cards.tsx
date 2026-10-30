/**
 * PROTOTYPE, throw away. Variant B: today's cards, worked out further. Each
 * card answers four questions in order: what is it (name, description),
 * what starts it (chips for every schedule, webhook and calling flow),
 * what is in it (node types, whether it asks you) and how it does (last
 * runs, how many finished). Run sits in the footer.
 */

import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
	FlowActions,
	LastRunsStrip,
	ProblemBadge,
	StepsLine,
	TriggerChips,
	useFlowFilter,
} from "./flow-parts";
import type { FlowRow } from "./flows-data";
import type { VariantProps } from "./flows-prototype";

export function VariantCards(props: VariantProps) {
	const { shown, toolbar } = useFlowFilter(props.rows);
	return (
		<div className="flex flex-col gap-4">
			{toolbar}
			{!props.rows ? (
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					<Skeleton className="h-64 w-full rounded-xl" />
					<Skeleton className="h-64 w-full rounded-xl" />
					<Skeleton className="hidden h-64 w-full rounded-xl xl:block" />
				</div>
			) : (
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{shown.map((row) => (
						<FlowCard key={row.name} row={row} {...props} />
					))}
				</div>
			)}
		</div>
	);
}

function FlowCard({
	row,
	projectId,
	now,
	healthNights,
	onRun,
	onDelete,
}: VariantProps & { row: FlowRow }) {
	const health = row.health;
	return (
		<Card
			size="sm"
			className="relative transition-colors hover:bg-muted/40 has-[a[data-stretched]:focus-visible]:ring-2 has-[a[data-stretched]:focus-visible]:ring-ring/50"
		>
			<CardHeader>
				<CardTitle className="flex min-w-0 items-center gap-2">
					<Link
						to="/projects/$projectId/flows/$name"
						params={{ projectId, name: row.name }}
						data-stretched=""
						className="truncate font-mono outline-none after:absolute after:inset-0"
					>
						{row.name}
					</Link>
					<ProblemBadge problem={row.problem} />
				</CardTitle>
				<CardDescription className="line-clamp-2">
					{row.flow.description ?? "No description"}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<Part label="Started by">
					<div className="relative z-10 flex flex-wrap gap-1">
						<TriggerChips row={row} />
					</div>
				</Part>
				{row.steps.length > 0 ? (
					<Part label="Steps">
						<StepsLine row={row} />
					</Part>
				) : null}
				<Part label={`Last ${healthNights ?? ""} nights`}>
					<div className="flex items-end justify-between gap-2">
						<LastRunsStrip row={row} now={now} />
						{health && health.runs > 0 ? (
							<div className="flex flex-col items-end gap-0.5 tabular-nums">
								<span className="font-medium text-lg leading-none">
									{health.rate === null ? "—" : `${health.rate}%`}
								</span>
								<span className="text-muted-foreground text-xs">
									finished of {health.runs}
								</span>
							</div>
						) : null}
					</div>
				</Part>
			</CardContent>
			<CardFooter className="mt-auto gap-2 border-t">
				<span className="min-w-0 truncate font-mono text-muted-foreground text-xs">
					{row.flow.inputs.length > 0
						? row.flow.inputs
								.map((input) => `${input.name}${input.required ? "" : "?"}`)
								.join(", ")
						: "No inputs"}
				</span>
				<div className="ml-auto">
					<FlowActions
						projectId={projectId}
						row={row}
						onRun={() => onRun(row)}
						onDelete={() => onDelete(row)}
						runVariant="default"
					/>
				</div>
			</CardFooter>
		</Card>
	);
}

function Part({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="font-medium text-muted-foreground text-xs">{label}</span>
			{children}
		</div>
	);
}
