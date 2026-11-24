/** The outcomes of an Agent node, and what it does when it needs input. */
import {
	type AgentNode,
	type Flow,
	type NodeOption,
	nodeOutcomes,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { RouteIcon } from "lucide-react";
import { OutcomesSuggest } from "../../../assistant";
import { DECIDED_BY_ICON } from "../../../canvas";
import { ChoiceField, InspectorSection, Note, withOptional } from "../form";
import { OutcomePill } from "./edge-inspector";
import { NodeOptionsField } from "./node-options-field";

/** What an Agent does when it needs input, in the order the toggle shows them. */
const ON_NEEDS_INPUT = [
	{ value: "edge", label: "Take an edge", icon: <RouteIcon /> },
	{ value: "person", label: "Ask a person", icon: <DECIDED_BY_ICON.person /> },
] as const;

/**
 * An Agent node ends on pass, fail or needs-input, or on one of its own
 * outcomes. The agent picks one in its report. When it needs input it
 * takes the needs-input edge, or asks a person (`ask`) and goes on with the
 * answer. Each own outcome has a handle; renaming one moves its edges,
 * removing one drops them (with an undo).
 */
export function AgentOutcomeSection({
	id,
	node,
	flow,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
	onSetOutcomes,
}: {
	id: string;
	node: AgentNode;
	flow: Flow;
	onChange: (change: (node: AgentNode) => AgentNode) => void;
	onRenameOutcome: (index: number, name: string) => string | null;
	onRemoveOutcome: (index: number) => void;
	onSetOutcomes: (outcomes: NodeOption[] | undefined) => void;
}) {
	const asks = node.ask === "person";
	const onNeedsInput = asks ? "person" : "edge";
	const lead = (
		<ChoiceField
			id={`${id}-ask`}
			label="When it needs input"
			hint={
				asks
					? "Night Shift asks you the questions of the agent. The agent continues with your answer. Stop makes the step fail."
					: "The run takes the needs input edge."
			}
			describedBy={`${id}-ask-hint`}
			value={onNeedsInput}
			choices={ON_NEEDS_INPUT}
			onChange={(next) =>
				onChange((current) =>
					withOptional(
						current,
						"ask",
						next === "person" ? "person" : undefined,
					),
				)
			}
		/>
	);
	const reads = (
		<Note>
			Later nodes read the outcome as <code>{`{{${node.id}.outcome}}`}</code>{" "}
			and the summary as <code>{`{{${node.id}.summary}}`}</code>.
		</Note>
	);

	if (!node.outcomes) {
		// Keep the edges the node has: seed with the standard outcomes they use.
		const used = new Set(
			flow.edges
				.filter((edge) => edge.from === node.id)
				.map((edge) => edge.outcome),
		);
		const seed: NodeOption[] = [
			{ name: "pass", description: "The work is done." },
			{ name: "fail", description: "The work could not be done." },
			...(used.has("needs-input") && !asks
				? [{ name: "needs-input", description: "A person must answer first." }]
				: []),
		];
		return (
			<InspectorSection title="Outcomes" tab="results" className="gap-3">
				{lead}
				<div className="flex flex-wrap gap-1.5">
					{nodeOutcomes(node).map((outcome) => (
						<OutcomePill key={outcome} outcome={outcome} />
					))}
				</div>
				<p className="text-xs text-muted-foreground">
					The standard outcomes are{" "}
					{asks ? "pass or fail" : "pass, fail, or needs input"}. You can use
					your own, such as approved and changes-requested.
				</p>
				<div className="flex flex-wrap items-center gap-1.5">
					<Button
						variant="outline"
						size="sm"
						onClick={() => onSetOutcomes(seed)}
					>
						Use own outcomes
					</Button>
					<OutcomesSuggest node={node} />
				</div>
				{reads}
			</InspectorSection>
		);
	}
	return (
		<NodeOptionsField
			id={id}
			kind="outcome"
			node={node}
			min={1}
			lead={lead}
			hint="The agent picks one. Each outcome gets its own edge. Describe when to pick it."
			onChange={onChange}
			onRenameOutcome={onRenameOutcome}
			onRemoveOutcome={onRemoveOutcome}
		>
			<div className="flex flex-wrap items-center gap-1.5">
				<OutcomesSuggest node={node} />
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onSetOutcomes(undefined)}
				>
					{asks
						? "Back to pass and fail"
						: "Back to pass, fail and needs input"}
				</Button>
			</div>
			{reads}
		</NodeOptionsField>
	);
}
