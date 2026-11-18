import { type FlowUse, rankFlowsByUse } from "@nightshift/client";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@nightshift/ui/components/combobox";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { WorkflowIcon } from "lucide-react";
import { useId, useState } from "react";
import { runQueries } from "@/features/runs/flows-port";
import { useNow } from "@/shared/format";
import { flowQueries } from "../queries";
import { StartRunForm } from "./start-run-form";

/** Enough recent runs to count which flows were used lately. */
const USE_RUNS = 200;

/**
 * Starts one of the project's flows, chosen in a searchable list: the flow
 * half of a quick run. Only flows without errors are in the list, the ones
 * you started most in the last 30 days first. The parent keeps the choice,
 * so it stays when the person switches tabs.
 */
export function PickFlowRunForm({
	projectId,
	flowName,
	onFlowNameChange,
	onStarted,
}: {
	projectId: string;
	flowName: string | null;
	onFlowNameChange: (name: string) => void;
	onStarted: () => void;
}) {
	const id = useId();
	const flows = useQuery(flowQueries.list(projectId));
	const runs = useQuery({
		...runQueries.ofProject(projectId, USE_RUNS),
		meta: { quietErrors: true },
	});
	const now = useNow(60_000);
	const runnable = (flows.data ?? []).filter(
		(flow) => flow.nodeCount !== null && flow.errorCount === 0,
	);
	const byName = new Map(runnable.map((flow) => [flow.name, flow]));
	const ranked = rankFlowsByUse([...byName.keys()], runs.data ?? [], now);
	const useOf = new Map(ranked.map((flow) => [flow.name, flow.use]));
	const names = ranked.map((flow) => flow.name);
	const chosenName =
		flowName !== null && byName.has(flowName) ? flowName : names[0];
	const chosen = chosenName === undefined ? null : byName.get(chosenName);

	// The whole list on open; filter only once the person types.
	const [typed, setTyped] = useState<string | null>(null);
	const query = typed?.trim().toLowerCase() ?? "";
	const shown =
		query === ""
			? names
			: names.filter(
					(name) =>
						name.toLowerCase().includes(query) ||
						byName.get(name)?.description?.toLowerCase().includes(query),
				);

	if (flows.isPending) {
		return (
			<div className="flex justify-center py-8">
				<Spinner aria-label="Loading flows" />
			</div>
		);
	}

	if (!chosen) {
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<WorkflowIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No flow to run</EmptyTitle>
					<EmptyDescription>
						{flows.error
							? flows.error.message
							: "Create a flow on the Flows page, or run a prompt."}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<StartRunForm
			key={chosen.name}
			projectId={projectId}
			flowName={chosen.name}
			inputs={chosen.inputs}
			onStarted={onStarted}
			picker={
				<Field>
					<FieldLabel htmlFor={`${id}-flow`}>Flow</FieldLabel>
					<Combobox
						items={names}
						filteredItems={shown}
						filter={null}
						value={chosen.name}
						inputValue={typed ?? chosen.name}
						onInputValueChange={(next) => setTyped(next)}
						onValueChange={(next: string | null) => {
							if (next) onFlowNameChange(next);
							setTyped(null);
						}}
						onOpenChange={(open) => {
							if (!open) setTyped(null);
						}}
					>
						<ComboboxInput
							id={`${id}-flow`}
							className="w-full font-mono"
							placeholder="Search flows"
							autoComplete="off"
							spellCheck={false}
							aria-describedby={
								chosen.description ? `${id}-flow-hint` : undefined
							}
						/>
						<ComboboxContent>
							<ComboboxEmpty>No flow with that name.</ComboboxEmpty>
							<ComboboxList>
								{(name: string) => (
									<ComboboxItem key={name} value={name}>
										<span className="truncate font-mono">{name}</span>
										<FlowUseText use={useOf.get(name)} />
									</ComboboxItem>
								)}
							</ComboboxList>
						</ComboboxContent>
					</Combobox>
					{chosen.description ? (
						<FieldDescription id={`${id}-flow-hint`}>
							{chosen.description}
						</FieldDescription>
					) : null}
				</Field>
			}
		/>
	);
}

/** How often a flow ran in the last 30 days, at the end of its row. */
function FlowUseText({ use }: { use: FlowUse | undefined }) {
	if (!use || use.runs === 0) return null;
	const runs = use.runs === 1 ? "1 run" : `${use.runs} runs`;
	return (
		<span
			className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
			title={
				use.manual > 0
					? `${runs} in the last 30 days, ${use.manual} started by hand`
					: `${runs} in the last 30 days`
			}
		>
			{runs}
		</span>
	);
}
