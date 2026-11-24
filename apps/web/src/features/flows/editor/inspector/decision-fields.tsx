/** The fields of a Decision node: who decides, the prompt, the options, and for a Gate the lock screen. */
import {
	type DecisionNode,
	type Flow,
	isPersonTier,
	withDecidedBy,
} from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { settingsQueries } from "@/features/settings";
import { OutcomesSuggest, RulesSuggest } from "../../assistant";
import { DECIDED_BY_ICON } from "../../canvas";
import { CascadeSection, ModelSettings } from "./agent";
import {
	type Choice,
	ChoiceField,
	InspectorSection,
	Note,
	SwitchField,
	withOptional,
} from "./form";
import {
	GateBriefSection,
	GateDeadlineSection,
	GateTitleField,
	lockScreenHint,
	withBrief,
} from "./gate";
import { NodeOptionsField } from "./outcomes";
import { TemplateField } from "./template";

/** Who decides, in the order the toggle shows them. */
const DECIDED_BY: Choice<DecisionNode["by"]>[] = [
	{ value: "person", label: "You", icon: <DECIDED_BY_ICON.person /> },
	{ value: "rule", label: "A rule", icon: <DECIDED_BY_ICON.rule /> },
	{ value: "model", label: "A model", icon: <DECIDED_BY_ICON.model /> },
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
					placeholder: "The agent wrote a reply: {{draft.summary}}. Send it?",
					invalid: node.prompt.trim() === "",
				}
			: by === "model"
				? {
						label: "Prompt",
						hint: "Say what to decide, and give the context it needs. The model picks one option and says why.",
						placeholder: "Read {{news.summary}}. Is this news worth a report?",
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

	// A person reads the impacts: on a Gate, or when the cascade ends with one.
	const personReads =
		by === "person" ||
		(by === "model" && (node.cascade ?? []).some((tier) => isPersonTier(tier)));

	// Settings → New nodes: the decider a node starts on when a model decides it.
	const settings = useQuery(settingsQueries.get());
	return (
		<>
			<InspectorSection title="Decision">
				<ChoiceField
					id={`${id}-by`}
					label="Decided by"
					hint={
						by === "person"
							? "The run waits in the Needs-you inbox until you pick an option."
							: by === "rule"
								? "A rule reads the values of earlier nodes and inputs. It uses no model and costs nothing."
								: "A small model reads the prompt and picks an option."
					}
					value={by}
					choices={DECIDED_BY}
					onChange={(next) =>
						onChange((current) =>
							withDecidedBy(current, next, settings.data?.values),
						)
					}
				/>
				{by === "person" ? (
					<GateTitleField
						id={`${id}-title`}
						flow={flow}
						nodeId={node.id}
						title={node.title}
						onChange={(title) =>
							onChange((current) => withOptional(current, "title", title))
						}
					/>
				) : null}
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
					<SwitchField
						id={`${id}-lock-screen`}
						label="Can be answered from the lock screen"
						description={lockScreenHint(node)}
						checked={node.lockScreen === true}
						onChange={(on) =>
							onChange((current) =>
								withOptional(current, "lockScreen", on ? true : undefined),
							)
						}
					/>
				) : null}
			</InspectorSection>

			{by === "person" ? (
				<GateBriefSection
					flow={flow}
					nodeId={node.id}
					fields={node}
					options={node.options.map((option) => option.name)}
					onChange={(brief) => onChange((current) => withBrief(current, brief))}
				/>
			) : null}

			<NodeOptionsField
				id={`${id}-options`}
				kind="option"
				node={node}
				min={1}
				hint={optionsHint}
				rules={by === "rule"}
				impacts={personReads}
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

			{by === "model" && node.cascade === undefined ? (
				<ModelSettings projectId={projectId} node={node} onChange={onChange} />
			) : null}
			{by === "model" ? (
				<CascadeSection
					projectId={projectId}
					flow={flow}
					node={node}
					onChange={onChange}
				/>
			) : null}
		</>
	);
}
