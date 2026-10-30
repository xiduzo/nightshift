/**
 * PROTOTYPE, throw away. Variant B: the flows grouped by how they start.
 * What needs a look comes first, then the scheduled flows by their next
 * start, the ones you start, and the ones other flows run. No table: each
 * group is a Card of Items.
 */

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
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
import { CircleAlertIcon, type LucideIcon } from "lucide-react";
import { Fragment } from "react";
import {
	FlowActions,
	LastRunsStrip,
	NextStart,
	ProblemBadge,
	START_ICON,
} from "./flow-parts";
import { type FlowRow, scheduleText } from "./flows-data";
import type { VariantProps } from "./flows-prototype";

type Group = {
	key: string;
	title: string;
	description: string;
	icon: LucideIcon;
	rows: FlowRow[];
};

export function VariantByStart(props: VariantProps) {
	const { rows } = props;
	if (!rows) {
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-40 w-full rounded-xl" />
				<Skeleton className="h-40 w-full rounded-xl" />
			</div>
		);
	}
	const ok = rows.filter((row) => row.problem === null);
	const groups: Group[] = [
		{
			key: "attention",
			title: "Need a look",
			description: "These flows have errors, or their last run failed.",
			icon: CircleAlertIcon,
			rows: rows.filter((row) => row.problem !== null),
		},
		{
			key: "schedule",
			title: "On a schedule",
			description:
				"Night Shift starts these for you. The next start comes first.",
			icon: START_ICON.schedule,
			rows: ok
				.filter((row) => row.start === "schedule" || row.start === "webhook")
				.sort(
					(a, b) =>
						(a.next?.nextAt ?? Number.POSITIVE_INFINITY) -
						(b.next?.nextAt ?? Number.POSITIVE_INFINITY),
				),
		},
		{
			key: "manual",
			title: "You start these",
			description: "No schedule starts them. Run one when you need it.",
			icon: START_ICON.manual,
			rows: ok.filter((row) => row.start === "manual"),
		},
		{
			key: "subflow",
			title: "Run inside other flows",
			description: "A Subflow node in another flow runs these.",
			icon: START_ICON.subflow,
			rows: ok.filter((row) => row.start === "subflow"),
		},
	];

	return (
		<div className="flex flex-col gap-4">
			{groups
				.filter((group) => group.rows.length > 0)
				.map((group) => (
					<Card key={group.key} size="sm">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<group.icon
									className="size-4 text-muted-foreground"
									aria-hidden="true"
								/>
								{group.title}
								<span className="font-normal text-muted-foreground tabular-nums">
									{group.rows.length}
								</span>
							</CardTitle>
							<CardDescription>{group.description}</CardDescription>
						</CardHeader>
						<CardContent className="px-2">
							<ItemGroup>
								{group.rows.map((row, index) => (
									<Fragment key={row.name}>
										{index > 0 ? <ItemSeparator /> : null}
										<FlowItem row={row} group={group.key} {...props} />
									</Fragment>
								))}
							</ItemGroup>
						</CardContent>
					</Card>
				))}
		</div>
	);
}

function FlowItem({
	row,
	group,
	projectId,
	now,
	onRun,
	onDelete,
}: VariantProps & { row: FlowRow; group: string }) {
	return (
		<Item size="sm" className="relative hover:bg-muted/40">
			<ItemContent className="min-w-0">
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
				{group === "subflow" ? (
					<span className="text-muted-foreground text-xs">
						Run by{" "}
						<span className="font-mono">{row.flow.callers.join(", ")}</span>
					</span>
				) : null}
			</ItemContent>
			{group === "schedule" && row.next ? (
				<div className="hidden w-56 flex-col gap-0.5 text-sm md:flex">
					<span>{scheduleText(row.next)}</span>
					<NextStart schedule={row.next} now={now} />
				</div>
			) : null}
			<ItemMedia className="hidden w-44 lg:flex">
				<LastRunsStrip row={row} now={now} max={7} />
			</ItemMedia>
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
