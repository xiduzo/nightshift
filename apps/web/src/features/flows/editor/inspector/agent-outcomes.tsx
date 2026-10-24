/** The outcomes of an Agent node, and the checker that picks one. */
import type { AgentNode, Flow, NodeOption } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { BotIcon } from "lucide-react";
import { deciderQueries } from "@/features/agents";
import { DECIDED_BY_ICON } from "../../canvas/node-type";
import { OutcomePill } from "../edge-inspector";
import { Field, InspectorSection, Note } from "../fields";
import { TemplateField } from "../template-field";
import { NodeOptionsField } from "./node-options-field";

/** Who picks an Agent node's outcome, in the order the toggle shows them. */
const PICKED_BY = [
	{ value: "agent", label: "The agent", icon: BotIcon },
	{ value: "model", label: "A model", icon: DECIDED_BY_ICON.model },
] as const;

/**
 * An Agent node ends on pass, fail or needs-input, or on one of its own
 * outcomes. The agent picks one in its report, or a model (the checker)
 * reads the report and picks. Each own outcome has a handle; renaming one
 * moves its edges, removing one drops them (with an undo).
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
	const pickedBy = node.checker ? "model" : "agent";
	const lead = (
		<>
			<Field
				id={`${id}-by`}
				label="Picked by"
				hint={
					pickedBy === "agent"
						? "The agent picks one outcome when it reports. Night Shift accepts only the outcomes below."
						: "The agent reports what it did. Then a model reads the report and picks one outcome below."
				}
			>
				<ToggleGroup
					variant="outline"
					size="sm"
					spacing={0}
					aria-label="Picked by"
					aria-describedby={`${id}-by-hint`}
					className="w-full"
					value={[pickedBy]}
					onValueChange={(value) => {
						const next = value[0] as "agent" | "model" | undefined;
						if (!next || next === pickedBy) return;
						onChange(({ checker: _, ...rest }) =>
							next === "model"
								? { ...rest, checker: { decider: "typesafe" } }
								: rest,
						);
					}}
				>
					{PICKED_BY.map((entry) => (
						<ToggleGroupItem
							key={entry.value}
							value={entry.value}
							className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
						>
							<entry.icon />
							{entry.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</Field>
			{node.checker ? (
				<CheckerFields
					id={`${id}-checker`}
					flow={flow}
					node={node}
					checker={node.checker}
					onChange={(checker) =>
						onChange((current) => ({ ...current, checker }))
					}
				/>
			) : null}
		</>
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
			...(used.has("needs-input")
				? [{ name: "needs-input", description: "A person must answer first." }]
				: []),
		];
		return (
			<InspectorSection title="Outcomes" className="gap-3">
				{lead}
				<div className="flex flex-wrap gap-1.5">
					{(["pass", "fail", "needs-input"] as const).map((outcome) => (
						<OutcomePill key={outcome} outcome={outcome} />
					))}
				</div>
				<p className="text-muted-foreground text-xs">
					The standard outcomes: pass, fail, or needs input. Use your own, such
					as approved and changes-requested, each with its own edge.
				</p>
				<Button
					variant="outline"
					size="sm"
					className="self-start"
					onClick={() => onSetOutcomes(seed)}
				>
					Use own outcomes
				</Button>
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
			hint="Exactly one is picked. Each outcome gets its own edge. A description says when to pick it."
			onChange={onChange}
			onRenameOutcome={onRenameOutcome}
			onRemoveOutcome={onRemoveOutcome}
		>
			<Button
				variant="ghost"
				size="sm"
				className="self-start"
				onClick={() => onSetOutcomes(undefined)}
			>
				Back to pass, fail and needs input
			</Button>
			{reads}
		</NodeOptionsField>
	);
}

type Checker = NonNullable<AgentNode["checker"]>;

/** The model that picks an Agent node's outcome: its decider, model and brief. */
function CheckerFields({
	id,
	flow,
	node,
	checker,
	onChange,
}: {
	id: string;
	flow: Flow;
	node: AgentNode;
	checker: Checker;
	onChange: (checker: Checker) => void;
}) {
	const deciders = useQuery(deciderQueries.list());
	const decider = deciders.data?.find((d) => d.name === checker.decider);
	const keyMissing = decider?.apiKeySource === "missing";
	return (
		<>
			<div className="grid grid-cols-2 gap-3">
				<Field
					id={`${id}-decider`}
					label="Decider"
					error={
						keyMissing && decider?.apiKey
							? `Add the secret ${decider.apiKey} on the Agents page.`
							: null
					}
				>
					<NativeSelect
						id={`${id}-decider`}
						value={checker.decider}
						aria-invalid={keyMissing}
						onChange={(event) => {
							const next = event.target.value as Checker["decider"];
							// A model belongs to its decider: the new one starts on its default.
							const { model: _, ...rest } = checker;
							onChange({ ...rest, decider: next });
						}}
					>
						{(deciders.data ?? []).map((d) => (
							<NativeSelectOption key={d.name} value={d.name}>
								{d.label}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
				<Field id={`${id}-model`} label="Model" optional>
					<Input
						id={`${id}-model`}
						list={`${id}-models`}
						value={checker.model ?? ""}
						placeholder={decider?.defaultModel}
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						onChange={(event) => {
							const model = event.target.value.trim();
							const { model: _, ...rest } = checker;
							onChange(model === "" ? rest : { ...rest, model });
						}}
					/>
					<datalist id={`${id}-models`}>
						{(decider?.models ?? []).map((value) => (
							<option key={value} value={value} />
						))}
					</datalist>
				</Field>
			</div>
			<TemplateField
				id={`${id}-prompt`}
				label="What to check (optional)"
				hint="The model also gets the task, the summary, the final message and the data."
				flow={flow}
				nodeId={node.id}
				value={checker.prompt ?? ""}
				placeholder="Pick pass only when the tests ran and passed."
				onChange={(text) => {
					const { prompt: _, ...rest } = checker;
					onChange(text === "" ? rest : { ...rest, prompt: text });
				}}
			/>
		</>
	);
}
