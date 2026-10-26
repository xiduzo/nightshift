/** The fields of a Decision node: who decides, the prompt, the options, and for a Gate the lock screen. */
import { type DecisionNode, type Flow, withDecidedBy } from "@nightshift/flows";
import {
	FieldContent,
	FieldDescription,
	FieldLabel,
	Field as ShadcnField,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Switch } from "@nightshift/ui/components/switch";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { deciderQueries } from "@/features/agents";
import { DECIDED_BY_ICON } from "../../canvas/node-type";
import { Field, InspectorSection, Note } from "../fields";
import { TemplateField } from "../template-field";
import { lockScreenHint } from "./lock-screen-hint";
import { deciderModelHint, withoutField } from "./model-defaults";
import { NodeOptionsField } from "./node-options-field";

/** Who decides, in the order the toggle shows them. */
const DECIDED_BY: {
	by: DecisionNode["by"];
	label: string;
}[] = [
	{ by: "person", label: "You" },
	{ by: "rule", label: "A rule" },
	{ by: "model", label: "A model" },
];

/**
 * One Decision node, three ways to decide. The prompt is the question for
 * you, a note for a rule, or the brief for a model. The options are the
 * outcomes; with a rule, each option carries the rule that picks it.
 */
export function DecisionFields({
	flow,
	node,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
}: {
	flow: Flow;
	node: DecisionNode;
	onChange: (change: (node: DecisionNode) => DecisionNode) => void;
	onRenameOutcome: (index: number, name: string) => string | null;
	onRemoveOutcome: (index: number) => void;
}) {
	const id = useId();
	const { by } = node;
	const prompt =
		by === "person"
			? {
					label: "Question",
					hint: "What you are asked in the Needs-you inbox, with the context you need to answer. The run waits until you do.",
					placeholder:
						"The worker opened {{worker.summary}}. Merge it and go on?",
					invalid: node.prompt.trim() === "",
				}
			: by === "model"
				? {
						label: "Prompt",
						hint: "What to decide, with the context it needs. The model picks one option and notes why.",
						placeholder:
							"Read {{check.log_tail}}. Is the build green enough to open a pull request?",
						invalid: node.prompt.trim() === "",
					}
				: {
						label: "Note",
						hint: "Optional. A note for you on what the rules check. Nothing reads it.",
						placeholder: "Ship when the tests pass and the check exits 0.",
						invalid: false,
					};
	const optionsHint =
		by === "person"
			? "Each option is a button in the inbox, with its own edge."
			: by === "model"
				? "The model picks exactly one. Each option gets its own edge. A description tells the model when to pick it."
				: "Night Shift tries the rules from top to bottom and picks the first option whose rule holds. Leave the last option without a rule: it is picked when none holds.";

	const deciders = useQuery(deciderQueries.list());
	const decider = deciders.data?.find((d) => d.name === node.decider);
	const keyMissing = decider?.apiKeySource === "missing";
	return (
		<>
			<InspectorSection title="Decision">
				<Field
					id={`${id}-by`}
					label="Decided by"
					hint={
						by === "person"
							? "The run waits in the Needs-you inbox until you pick an option."
							: by === "rule"
								? "A rule reads the values of earlier nodes and inputs. No model, no cost."
								: "A small model reads the prompt and picks an option."
					}
				>
					<ToggleGroup
						variant="outline"
						size="sm"
						spacing={0}
						aria-label="Decided by"
						className="w-full"
						value={[by]}
						onValueChange={(value) => {
							const next = value[0] as DecisionNode["by"] | undefined;
							if (next) onChange((current) => withDecidedBy(current, next));
						}}
					>
						{DECIDED_BY.map((entry) => {
							const Icon = DECIDED_BY_ICON[entry.by];
							return (
								<ToggleGroupItem
									key={entry.by}
									value={entry.by}
									className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
								>
									<Icon />
									{entry.label}
								</ToggleGroupItem>
							);
						})}
					</ToggleGroup>
				</Field>
				<TemplateField
					id={`${id}-prompt`}
					label={prompt.label}
					hint={prompt.hint}
					flow={flow}
					nodeId={node.id}
					value={node.prompt}
					invalid={prompt.invalid}
					className={by === "person" ? "font-sans text-sm" : undefined}
					placeholder={prompt.placeholder}
					assist="prompt"
					onChange={(text) =>
						onChange((current) => ({ ...current, prompt: text }))
					}
				/>
				{by === "person" ? (
					<ShadcnField orientation="horizontal" className="items-start">
						<Switch
							id={`${id}-lock-screen`}
							checked={node.lockScreen === true}
							className="mt-0.5"
							aria-describedby={`${id}-lock-screen-hint`}
							onCheckedChange={(on) =>
								onChange(({ lockScreen: _, ...current }) =>
									on ? { ...current, lockScreen: true } : current,
								)
							}
						/>
						<FieldContent>
							<FieldLabel htmlFor={`${id}-lock-screen`}>
								Can be answered from the lock screen
							</FieldLabel>
							<FieldDescription
								id={`${id}-lock-screen-hint`}
								className="text-xs"
							>
								{lockScreenHint(node)}
							</FieldDescription>
						</FieldContent>
					</ShadcnField>
				) : null}
			</InspectorSection>

			<NodeOptionsField
				id={`${id}-options`}
				kind="option"
				node={node}
				min={1}
				hint={optionsHint}
				rules={by === "rule"}
				onChange={onChange}
				onRenameOutcome={onRenameOutcome}
				onRemoveOutcome={onRemoveOutcome}
			>
				{by === "rule" ? (
					<Note>
						A rule is a JSONata expression over the run's values. Write a node
						id or an input name, then a path:{" "}
						<code>build.data.tests_passed = true and check.exit_code = 0</code>.
						Put a name with a dash in backticks: <code>`my-input` = "x"</code>.
						Later nodes read the pick as <code>{`{{${node.id}.outcome}}`}</code>
						.
					</Note>
				) : (
					<Note>
						Later nodes read the pick as <code>{`{{${node.id}.outcome}}`}</code>{" "}
						and {by === "person" ? "your note" : "why the model picked it"} as{" "}
						<code>{`{{${node.id}.note}}`}</code>.
					</Note>
				)}
			</NodeOptionsField>

			{by === "model" ? (
				<InspectorSection title="Model">
					<Field
						id={`${id}-decider`}
						label="Decider"
						hint={
							keyMissing && decider?.apiKey
								? `Add the secret ${decider.apiKey} on the Agents page, or this node cannot decide.`
								: "The decision model that picks the option."
						}
					>
						<NativeSelect
							id={`${id}-decider`}
							value={node.decider}
							aria-invalid={keyMissing}
							aria-describedby={`${id}-decider-hint`}
							onChange={(event) => {
								const next = event.target.value as DecisionNode["decider"];
								// A model belongs to its decider: the new one starts on its default.
								onChange((current) => ({
									...withoutField(current, "model"),
									decider: next,
								}));
							}}
						>
							{(deciders.data ?? []).map((d) => (
								<NativeSelectOption key={d.name} value={d.name}>
									{d.label}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>
					<Field
						id={`${id}-model`}
						label="Model"
						optional
						hint={deciderModelHint(decider)}
					>
						<Input
							id={`${id}-model`}
							list={`${id}-models`}
							value={node.model ?? ""}
							placeholder={decider?.defaultModel}
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
							aria-describedby={`${id}-model-hint`}
							onChange={(event) => {
								const model = event.target.value.trim();
								onChange((current) =>
									model === ""
										? withoutField(current, "model")
										: { ...current, model },
								);
							}}
						/>
						<datalist id={`${id}-models`}>
							{(decider?.models ?? []).map((value) => (
								<option key={value} value={value} />
							))}
						</datalist>
					</Field>
				</InspectorSection>
			) : null}
		</>
	);
}
