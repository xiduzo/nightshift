import {
	edgeInLoop,
	type Flow,
	type FlowEdge,
	nodeOutcomes,
	type Outcome,
	type OutcomeColor,
	outcomeColor,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { cn } from "@nightshift/ui/lib/utils";
import { ArrowRightIcon, SplineIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";
import { PanelHeader } from "@/shared/panel";
import { groupEdges, pairKey } from "../canvas/edge-groups";
import { outcomeLabel, outcomeStyle } from "../canvas/outcome-badge";
import { Field, InspectorSection, PositiveIntInput } from "./fields";

/** An outcome as a small outline Badge in its own colour. */
export function OutcomePill({
	outcome,
	color,
	className,
}: {
	outcome: Outcome;
	color?: OutcomeColor;
	className?: string;
}) {
	return (
		<Badge
			variant="outline"
			className={cn(outcomeStyle(outcome, color).badge, "font-mono", className)}
		>
			{outcomeLabel(outcome)}
		</Badge>
	);
}

export function EdgeInspector({
	flow,
	edge,
	onSelectEdge,
	onChange,
	onDelete,
}: {
	flow: Flow;
	edge: FlowEdge;
	/** Selects another edge of the flow: one that shares this edge's line. */
	onSelectEdge: (id: string) => void;
	onChange: (change: (edge: FlowEdge) => FlowEdge) => void;
	onDelete: () => void;
}) {
	const id = useId();
	const source = flow.nodes.find((node) => node.id === edge.from);
	const known = source ? [...new Set(nodeOutcomes(source))] : [];
	// An edge on an outcome its node no longer has keeps it until changed.
	const missing = !known.includes(edge.outcome);
	const outcomes = missing ? [edge.outcome, ...known] : known;
	const loopsBack = edgeInLoop(flow, edge);
	// The canvas draws the edges between two nodes as one line.
	const siblings =
		groupEdges(flow).find((group) => group.key === pairKey(edge.from, edge.to))
			?.edges ?? [];

	return (
		<div className="flex flex-col">
			<PanelHeader
				icon={SplineIcon}
				kicker="Edge"
				title={
					<span className="flex min-w-0 items-center gap-1.5">
						<span className="truncate">{edge.from}</span>
						<ArrowRightIcon
							className="size-3.5 shrink-0 text-muted-foreground"
							aria-label="to"
						/>
						<span className="truncate">{edge.to}</span>
					</span>
				}
				badges={
					<OutcomePill
						outcome={edge.outcome}
						color={source && outcomeColor(source, edge.outcome)}
						className="normal-case"
					/>
				}
				actions={
					<Button
						variant="ghost"
						size="icon-sm"
						className="text-destructive hover:bg-destructive/10 hover:text-destructive"
						onClick={onDelete}
						aria-label="Delete edge"
						title="Delete edge (Backspace)"
					>
						<Trash2Icon />
					</Button>
				}
			/>

			<InspectorSection title="Route">
				{siblings.length > 1 ? (
					<Field
						id={`${id}-line`}
						label="Edges on this line"
						hint={`${siblings.length} edges lead from ${edge.from} to ${edge.to}. Pick the one to change or delete.`}
					>
						<ToggleGroup
							id={`${id}-line`}
							variant="outline"
							size="sm"
							spacing={0}
							className="flex-wrap"
							aria-describedby={`${id}-line-hint`}
							value={[edge.id]}
							onValueChange={(next: string[]) => {
								const pick = next[0];
								if (pick) onSelectEdge(pick);
							}}
						>
							{siblings.map((sibling) => (
								<ToggleGroupItem
									key={sibling.id}
									value={sibling.id}
									className={cn(
										"font-mono",
										outcomeStyle(
											sibling.outcome,
											source && outcomeColor(source, sibling.outcome),
										).text,
									)}
								>
									{outcomeLabel(sibling.outcome)}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</Field>
				) : null}
				<Field
					id={`${id}-outcome`}
					label="Outcome"
					error={
						missing
							? `${edge.from} has no ${outcomeLabel(edge.outcome)} outcome. Pick one it has.`
							: null
					}
					hint={`The run takes this edge when ${edge.from} ends with this outcome.`}
				>
					<NativeSelect
						id={`${id}-outcome`}
						value={edge.outcome}
						className="w-full"
						aria-invalid={missing}
						aria-describedby={`${id}-outcome-hint`}
						onChange={(event) => {
							const outcome = event.target.value as Outcome;
							onChange((current) => ({ ...current, outcome }));
						}}
					>
						{outcomes.map((outcome) => (
							<NativeSelectOption key={outcome} value={outcome}>
								{outcomeLabel(outcome)}
								{missing && outcome === edge.outcome ? " (missing)" : ""}
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
			</InspectorSection>
		</div>
	);
}
