import type { FlowOverview } from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@nightshift/ui/components/input-group";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { SearchIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

type Filter = "all" | "own" | "subflow" | "hand" | "look";

/**
 * The filters of the Flows page. They can overlap: a scheduled flow can
 * also be a Subflow. A flow with only paused schedules runs only by hand.
 */
const FILTERS: {
	value: Filter;
	label: string;
	test: (overview: FlowOverview) => boolean;
}[] = [
	{ value: "all", label: "All", test: () => true },
	{
		value: "own",
		label: "Start on their own",
		test: (overview) => overview.startsOnItsOwn,
	},
	{
		value: "subflow",
		label: "Subflows",
		test: (overview) => overview.flow.callers.length > 0,
	},
	{
		value: "hand",
		label: "Only by hand",
		test: (overview) =>
			!overview.startsOnItsOwn && overview.flow.callers.length === 0,
	},
	{
		value: "look",
		label: "Need a look",
		test: (overview) => overview.problem !== null,
	},
];

/**
 * A search on name and description, and the filters, with how many flows
 * each one keeps. Returns the flows they leave and the bar that sets them.
 */
export function useFlowFilter(overviews: FlowOverview[] | undefined): {
	shown: FlowOverview[];
	filtered: boolean;
	bar: ReactNode;
} {
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	const all = overviews ?? [];
	const test = FILTERS.find((f) => f.value === filter)?.test ?? (() => true);
	const needle = query.trim().toLowerCase();
	const shown = all.filter(
		(overview) =>
			test(overview) &&
			(needle === "" ||
				overview.flow.name.toLowerCase().includes(needle) ||
				(overview.flow.description ?? "").toLowerCase().includes(needle)),
	);

	const bar = (
		<div className="flex flex-wrap items-center gap-2">
			<InputGroup className="w-full sm:w-64">
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
			<ToggleGroup
				variant="outline"
				size="sm"
				spacing={0}
				value={[filter]}
				onValueChange={(next) => {
					const [value] = next as Filter[];
					if (value) setFilter(value);
				}}
				aria-label="Show flows"
			>
				{FILTERS.map((f) => {
					const count = all.filter(f.test).length;
					return (
						<ToggleGroupItem key={f.value} value={f.value}>
							{f.label}
							{f.value !== "all" && count > 0 ? (
								<Badge
									variant={f.value === "look" ? "destructive" : "secondary"}
									className="tabular-nums"
								>
									{count}
								</Badge>
							) : null}
						</ToggleGroupItem>
					);
				})}
			</ToggleGroup>
		</div>
	);

	return { shown, filtered: needle !== "" || filter !== "all", bar };
}
