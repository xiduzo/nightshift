import {
	type Flow,
	type FlowEdge,
	type Outcome,
	outcomesByType,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { ArrowRightIcon, Trash2Icon, WorkflowIcon } from "lucide-react";
import { useId } from "react";

import { outcomeLabel } from "@/components/outcome-badge";
import { edgeInLoop } from "@/lib/flow-draft";

import { Field, PositiveIntInput } from "./fields";

const ALL_OUTCOMES: Outcome[] = ["pass", "fail", "needs-input"];

export function EdgeInspector({
	flow,
	edge,
	onChange,
	onDelete,
}: {
	flow: Flow;
	edge: FlowEdge;
	onChange: (change: (edge: FlowEdge) => FlowEdge) => void;
	onDelete: () => void;
}) {
	const id = useId();
	const source = flow.nodes.find((node) => node.id === edge.from);
	const outcomes = source ? outcomesByType[source.type] : ALL_OUTCOMES;
	const loopsBack = edgeInLoop(flow, edge);

	return (
		<div className="flex flex-col gap-4">
			<header className="flex items-center gap-2">
				<WorkflowIcon
					className="size-4 text-muted-foreground"
					aria-hidden="true"
				/>
				<h2 className="font-medium text-sm">Edge</h2>
				<Button
					variant="destructive"
					size="icon-xs"
					className="ml-auto"
					onClick={onDelete}
					aria-label="Delete edge"
					title="Delete edge (Backspace)"
				>
					<Trash2Icon />
				</Button>
			</header>

			<p className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
				<span>{edge.from}</span>
				<ArrowRightIcon
					className="size-3.5 text-muted-foreground"
					aria-label="to"
				/>
				<span>{edge.to}</span>
			</p>

			<Field
				id={`${id}-outcome`}
				label="Outcome"
				hint={`The run takes this edge when ${edge.from} ends with this outcome.`}
			>
				<NativeSelect
					id={`${id}-outcome`}
					value={edge.outcome}
					aria-describedby={`${id}-outcome-hint`}
					onChange={(event) => {
						const outcome = event.target.value as Outcome;
						onChange((current) => ({ ...current, outcome }));
					}}
				>
					{outcomes.map((outcome) => (
						<NativeSelectOption key={outcome} value={outcome}>
							{outcomeLabel(outcome)}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</Field>

			<Field
				id={`${id}-max`}
				label="Max times taken"
				optional={!loopsBack}
				hint={
					loopsBack
						? "This edge is part of a loop. Every loop needs a max on one of its edges, or the flow cannot run."
						: "When the max is hit, the run takes the next edge on this outcome, or fails."
				}
			>
				<PositiveIntInput
					id={`${id}-max`}
					value={edge.max}
					placeholder="No limit"
					describedBy={`${id}-max-hint`}
					onChange={(max) => onChange((current) => ({ ...current, max }))}
				/>
			</Field>
		</div>
	);
}
