import { Button } from "@nightshift/ui/components/button";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import { DialogFooter } from "@nightshift/ui/components/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, HourglassIcon } from "lucide-react";
import { useId } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { useNow } from "@/hooks/use-now";
import type { OpenGate, Project } from "@/lib/api-types";
import { formatWaited } from "@/lib/format";

import { HOUR_MS } from "./activity";
import {
	ChartSection,
	DetailsDialog,
	DetailsEmpty,
	DetailsHeader,
	Stat,
	Swatch,
} from "./details";

/** The open Gates listed here; the inbox has the rest. */
const LIST_MAX = 8;
/** Upper bounds of the age buckets, in hours. */
const AGES = [
	{ below: 1, label: "< 1 h" },
	{ below: 6, label: "1–6 h" },
	{ below: 24, label: "6–24 h" },
	{ below: 72, label: "1–3 days" },
	{ below: Number.POSITIVE_INFINITY, label: "> 3 days" },
];
const CHART_CONFIG = {
	gates: { label: "Open Gates", color: "var(--status-waiting)" },
} satisfies ChartConfig;

/**
 * What waits for you, in detail: the open Gates, oldest first, and how long
 * they have waited. Behind the "Waiting for you" card.
 */
export function GatesDialog({
	open,
	onOpenChange,
	gates,
	project,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The open Gates, of `project` when given. */
	gates: OpenGate[];
	project?: Project;
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<GatesDetails
				gates={gates}
				project={project}
				onNavigate={() => onOpenChange(false)}
			/>
		</DetailsDialog>
	);
}

function GatesDetails({
	gates,
	project,
	onNavigate,
}: {
	gates: OpenGate[];
	project?: Project;
	onNavigate: () => void;
}) {
	const id = useId();
	const now = useNow(60_000);
	const oldestFirst = gates.slice().sort((a, b) => a.openedAt - b.openedAt);
	const waits = oldestFirst.map((gate) => Math.max(now - gate.openedAt, 0));
	const oldest = waits[0];
	const median = waits[Math.floor((waits.length - 1) / 2)];
	const runs = new Set(gates.map((gate) => gate.runId)).size;
	const rows = AGES.map((age, index) => ({
		label: age.label,
		gates: waits.filter(
			(wait) =>
				wait < age.below * HOUR_MS &&
				wait >= (AGES[index - 1]?.below ?? 0) * HOUR_MS,
		).length,
	}));

	return (
		<>
			<DetailsHeader project={project} trail="Inbox" title="Gates" />

			<Item variant="muted" size="sm">
				<ItemMedia variant="icon">
					<HourglassIcon />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>Waiting for you</ItemTitle>
					<ItemDescription>
						{oldest === undefined
							? "Nothing needs you"
							: `The oldest waits for ${formatWaited(oldest)}`}
					</ItemDescription>
				</ItemContent>
				<ItemActions className="font-semibold text-lg tabular-nums">
					{gates.length}
				</ItemActions>
			</Item>

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Stat label="Open Gates" value={String(gates.length)} />
				<Stat label="Runs waiting" value={String(runs)} />
				<Stat
					label="Oldest"
					value={oldest === undefined ? "—" : formatWaited(oldest)}
				/>
				<Stat
					label="Median wait"
					value={median === undefined ? "—" : formatWaited(median)}
				/>
			</div>

			<ChartSection
				title="Waiting for"
				hint="The open Gates by how long they wait"
			>
				{gates.length === 0 ? (
					<DetailsEmpty>No Gate waits for your answer.</DetailsEmpty>
				) : (
					<ChartContainer
						config={CHART_CONFIG}
						className="aspect-auto h-44 w-full"
					>
						<BarChart data={rows} margin={{ left: 0, right: 0 }}>
							<CartesianGrid vertical={false} />
							<XAxis
								dataKey="label"
								tickLine={false}
								axisLine={false}
								tickMargin={8}
							/>
							<YAxis
								tickLine={false}
								axisLine={false}
								width={32}
								allowDecimals={false}
							/>
							<ChartTooltip
								cursor={false}
								content={
									<ChartTooltipContent
										formatter={(value) => (
											<div className="flex w-full items-center gap-2">
												<Swatch color="var(--color-gates)" />
												<span className="text-muted-foreground">
													Open Gates
												</span>
												<span className="ml-auto font-medium font-mono tabular-nums">
													{Number(value)}
												</span>
											</div>
										)}
									/>
								}
							/>
							<Bar
								dataKey="gates"
								fill="var(--color-gates)"
								radius={[4, 4, 0, 0]}
							/>
						</BarChart>
					</ChartContainer>
				)}
			</ChartSection>

			{oldestFirst.length > 0 ? (
				<section
					aria-labelledby={`${id}-oldest`}
					className="flex flex-col gap-2"
				>
					<h3 id={`${id}-oldest`} className="font-medium text-base">
						Oldest first
					</h3>
					<ItemGroup className="gap-1">
						{oldestFirst.slice(0, LIST_MAX).map((gate) => (
							<Item
								key={gate.stepId}
								size="xs"
								render={
									<Link
										to="/runs/$runId"
										params={{ runId: gate.runId }}
										onClick={onNavigate}
									/>
								}
							>
								<ItemContent className="min-w-0">
									<ItemTitle className="w-full truncate">
										{gate.question}
									</ItemTitle>
									<ItemDescription className="truncate">
										{project ? null : `${gate.projectName}, `}
										{gate.runTitle}
									</ItemDescription>
								</ItemContent>
								<ItemActions className="text-muted-foreground tabular-nums">
									{formatWaited(now - gate.openedAt)}
								</ItemActions>
							</Item>
						))}
					</ItemGroup>
					{oldestFirst.length > LIST_MAX ? (
						<p className="text-muted-foreground text-xs">
							{oldestFirst.length - LIST_MAX} more in the inbox.
						</p>
					) : null}
				</section>
			) : null}

			<DialogFooter>
				<Button
					variant="outline"
					nativeButton={false}
					render={<Link to="/inbox" onClick={onNavigate} />}
				>
					Inbox
					<ArrowRightIcon data-icon="inline-end" />
				</Button>
			</DialogFooter>
		</>
	);
}
