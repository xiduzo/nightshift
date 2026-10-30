/** The fields of a Decision node: who decides, the prompt, the options, and for a Gate the lock screen. */
import { type DecisionNode, type Flow, withDecidedBy } from "@nightshift/flows";
import {
	FieldContent,
	FieldDescription,
	FieldLabel,
	Field as ShadcnField,
} from "@nightshift/ui/components/field";
import { Switch } from "@nightshift/ui/components/switch";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { settingsQueries } from "@/features/settings";
import { OutcomesSuggest, RulesSuggest } from "../../assistant/field-helpers";
import { DECIDED_BY_ICON } from "../../canvas/node-type";
import { Field, InspectorSection, Note } from "../fields";
import { TemplateField } from "../template-field";
import { GateDeadlineSection } from "./gate-deadline-fields";
import { lockScreenHint } from "./lock-screen-hint";
import { ModelSettings } from "./model-settings";
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
	projectId,
	flow,
	node,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
}: {
	projectId: string;
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
					hint: "Write the question in Markdown, with the context you need to answer. It shows in the Needs-you inbox.",
					placeholder:
						"The worker opened {{worker.summary}}. Merge it and continue?",
					invalid: node.prompt.trim() === "",
				}
			: by === "model"
				? {
						label: "Prompt",
						hint: "Say what to decide, and give the context it needs. The model picks one option and says why.",
						placeholder:
							"Read {{check.log_tail}}. Is the build green enough to open a pull request?",
						invalid: node.prompt.trim() === "",
					}
				: {
						label: "Note",
						hint: "Optional. Say what the rules check. Only you read it.",
						placeholder: "Ship when the tests pass and the check exits 0.",
						invalid: false,
					};
	const optionsHint =
		by === "person"
			? "Each option is a button in the inbox, with its own edge."
			: by === "model"
				? "The model picks one. Each option gets its own edge. Describe when to pick it."
				: "Night Shift picks the first option from the top whose rule holds. Leave the last option without a rule. Night Shift picks it when no rule holds.";

	// Settings → New nodes: the decider a node starts on when a model decides it.
	const settings = useQuery(settingsQueries.get());
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
								? "A rule reads the values of earlier nodes and inputs. It uses no model and costs nothing."
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
							if (next) {
								onChange((current) =>
									withDecidedBy(current, next, settings.data?.values),
								);
							}
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
					language="markdown"
					label={prompt.label}
					hint={prompt.hint}
					flow={flow}
					nodeId={node.id}
					value={node.prompt}
					invalid={prompt.invalid}
					className={by === "person" ? "font-sans text-sm" : undefined}
					placeholder={prompt.placeholder}
					// A note for the rules: nothing reads it, so no helper.
					assist={by === "rule" ? undefined : "prompt"}
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
				<div className="flex flex-wrap items-center gap-1.5">
					<OutcomesSuggest node={node} />
					{by === "rule" ? <RulesSuggest node={node} /> : null}
				</div>
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

			{by === "person" ? (
				<GateDeadlineSection flow={flow} node={node} onChange={onChange} />
			) : null}

			{by === "model" ? (
				<ModelSettings projectId={projectId} node={node} onChange={onChange} />
			) : null}
		</>
	);
}
