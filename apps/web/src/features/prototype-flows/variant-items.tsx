/**
 * PROTOTYPE, throw away. Variant C: the flows as Items in one Card, between
 * the cards and the table. Each row leads with how its last run went, then
 * the flow with a line of chips for what starts it and what is in it. The
 * last runs and Run sit on the right. No fixed columns, so a flow with
 * three schedules and two calling flows still fits.
 */

import { Card, CardContent } from "@nightshift/ui/components/card";
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
	ItemMedia,
	ItemSeparator,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { CircleDashedIcon } from "lucide-react";
import { Fragment } from "react";
import { RunStatusIcon } from "@/features/runs";
import {
	FinishedCell,
	FlowActions,
	LastRunsStrip,
	ProblemBadge,
	StepsLine,
	TriggerChips,
	useFlowFilter,
} from "./flow-parts";
import type { FlowRow } from "./flows-data";
import type { VariantProps } from "./flows-prototype";

export function VariantItems(props: VariantProps) {
	const { rows, error } = props;
	const { shown, toolbar } = useFlowFilter(rows);
	return (
		<Card className="gap-0 py-0">
			<CardContent className="px-0">
				<div className="border-b px-6 py-3">{toolbar}</div>
				{!rows ? (
					<div className="flex flex-col gap-2 px-6 py-4">
						<Skeleton className="h-14 w-full" />
						<Skeleton className="h-14 w-full" />
					</div>
				) : shown.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>No flows match</EmptyTitle>
							<EmptyDescription>
								{error?.message ?? "Try another search or filter."}
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<ItemGroup className="p-2">
						{shown.map((row, index) => (
							<Fragment key={row.name}>
								{index > 0 ? <ItemSeparator className="my-0" /> : null}
								<FlowItem row={row} {...props} />
							</Fragment>
						))}
					</ItemGroup>
				)}
			</CardContent>
		</Card>
	);
}

function FlowItem({
	row,
	projectId,
	now,
	onRun,
	onDelete,
}: VariantProps & { row: FlowRow }) {
	const last = row.health?.last;
	return (
		<Item className="relative items-start hover:bg-muted/40">
			<ItemMedia variant="icon" className="mt-0.5">
				{last ? (
					<RunStatusIcon status={last.status} className="[&>svg]:size-5" />
				) : (
					<CircleDashedIcon
						className="size-5 text-muted-foreground"
						aria-label="Never run"
					/>
				)}
			</ItemMedia>
			<ItemContent className="min-w-0 gap-1.5">
				<ItemTitle className="flex items-center gap-2">
					<Link
						to="/projects/$projectId/flows/$name"
						params={{ projectId, name: row.name }}
						className="font-mono after:absolute after:inset-0"
					>
						{row.name}
					</Link>
					<ProblemBadge problem={row.problem} />
				</ItemTitle>
				<ItemDescription className="line-clamp-1">
					{row.flow.description ?? "No description"}
				</ItemDescription>
				<div className="relative z-10 flex flex-wrap items-center gap-1">
					<TriggerChips row={row} />
					<span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
					<StepsLine row={row} />
				</div>
			</ItemContent>
			<div className="hidden w-48 lg:block">
				<LastRunsStrip row={row} now={now} />
			</div>
			<div className="hidden w-16 xl:block">
				<FinishedCell row={row} />
			</div>
			<ItemActions>
				<FlowActions
					projectId={projectId}
					row={row}
					onRun={() => onRun(row)}
					onDelete={() => onDelete(row)}
				/>
			</ItemActions>
		</Item>
	);
}
