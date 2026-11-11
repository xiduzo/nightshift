import type { FlowOverview } from "@nightshift/client";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@nightshift/ui/components/input-group";
import { SearchIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

/**
 * A search on the name and description of the flows. Returns the flows it
 * leaves and the field that sets it, for the page heading.
 */
export function useFlowFilter(overviews: FlowOverview[] | undefined): {
	shown: FlowOverview[];
	search: ReactNode;
} {
	const [query, setQuery] = useState("");
	const needle = query.trim().toLowerCase();
	const shown = (overviews ?? []).filter(
		(overview) =>
			needle === "" ||
			overview.flow.name.toLowerCase().includes(needle) ||
			(overview.flow.description ?? "").toLowerCase().includes(needle),
	);

	const search = (
		<InputGroup className="w-40 sm:w-64">
			<InputGroupAddon>
				<SearchIcon aria-hidden="true" />
			</InputGroupAddon>
			<InputGroupInput
				type="search"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Find a flow"
				aria-label="Find a flow"
			/>
		</InputGroup>
	);

	return { shown, search };
}

/** "6 flows. 2 start on a schedule, 1 on a webhook." */
export function flowsSummary(overviews: readonly FlowOverview[]): string {
	const on = (kind: "schedule" | "webhook") =>
		overviews.filter((overview) =>
			overview.starts.some(
				(start) =>
					start.kind !== "subflow" &&
					start.kind === kind &&
					start.schedule.enabled,
			),
		).length;
	const total = `${overviews.length} ${overviews.length === 1 ? "flow" : "flows"}.`;
	const parts = [
		{ n: on("schedule"), what: "on a schedule" },
		{ n: on("webhook"), what: "on a webhook" },
	].filter((part) => part.n > 0);
	if (parts.length === 0) return `${total} You start each one by hand.`;
	const said = parts.map(
		(part, index) =>
			`${part.n}${index === 0 ? (part.n === 1 ? " starts" : " start") : ""} ${part.what}`,
	);
	return `${total} ${said.join(", ")}.`;
}
