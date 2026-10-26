/** The fields of a Value node: who makes the value, and its schema. */
import { type Flow, type ValueNode, withValueBy } from "@nightshift/flows";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Textarea } from "@nightshift/ui/components/textarea";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { deciderQueries } from "@/features/agents";
import { ExpressionSuggest } from "../../assistant/field-helpers";
import { VALUE_BY_ICON } from "../../canvas/node-type";
import { Field, InspectorSection, Note } from "../fields";
import { OutputSchemaField } from "../output-schema-field";
import { TemplateField } from "../template-field";
import { deciderModelHint, withoutField } from "./model-defaults";

const VALUE_BY: { by: ValueNode["by"]; label: string }[] = [
	{ by: "rule", label: "A rule" },
	{ by: "model", label: "A model" },
];

const EXPRESSION_EXAMPLE =
	'$filter(planner.data.tasks, function($t) { $t.size = "small" })';

/**
 * A Value node makes data that fits its output schema. Who makes it is a
 * toggle, as on a Decision: a rule (a JSONata expression) or a model (a
 * decider that can make a value, with a prompt).
 */
export function ValueFields({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: ValueNode;
	onChange: (change: (node: ValueNode) => ValueNode) => void;
}) {
	const id = useId();
	const { by } = node;
	const deciders = useQuery(deciderQueries.list());
	const makers = (deciders.data ?? []).filter((d) => d.value !== null);
	const decider = deciders.data?.find((d) => d.name === node.decider);
	const keyMissing = decider?.apiKeySource === "missing";
	const cannot = decider !== undefined && decider.value === null;
	const expression = node.expression ?? "";
	const prompt = node.prompt ?? "";
	return (
		<>
			<InspectorSection title="Value">
				<Field
					id={`${id}-by`}
					label="Made by"
					hint={
						by === "rule"
							? "An expression reads the values of earlier nodes and inputs. No model, no cost."
							: "A small model reads the prompt and answers with data in the shape below."
					}
				>
					<ToggleGroup
						variant="outline"
						size="sm"
						spacing={0}
						aria-label="Made by"
						className="w-full"
						value={[by]}
						onValueChange={(value) => {
							const next = value[0] as ValueNode["by"] | undefined;
							if (next) onChange((current) => withValueBy(current, next));
						}}
					>
						{VALUE_BY.map((entry) => {
							const Icon = VALUE_BY_ICON[entry.by];
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
				{by === "rule" ? (
					<Field
						id={`${id}-expression`}
						label="Expression"
						hint="A JSONata expression over the run's values. Its result is the data."
						error={expression.trim() === "" ? "Write the expression." : null}
					>
						<Textarea
							id={`${id}-expression`}
							value={expression}
							placeholder={EXPRESSION_EXAMPLE}
							className="max-h-80 min-h-24 font-mono text-xs leading-relaxed"
							spellCheck={false}
							aria-invalid={expression.trim() === ""}
							aria-describedby={`${id}-expression-hint`}
							onChange={(event) => {
								const text = event.target.value;
								onChange((current) => ({ ...current, expression: text }));
							}}
						/>
						<div className="self-start">
							<ExpressionSuggest node={node} />
						</div>
					</Field>
				) : (
					<TemplateField
						id={`${id}-prompt`}
						language="markdown"
						label="Prompt"
						hint="What to make, with the context it needs. The model answers with data in the shape below."
						flow={flow}
						nodeId={node.id}
						value={prompt}
						invalid={prompt.trim() === ""}
						placeholder="List the failing tests in {{check.log_tail}}."
						assist="prompt"
						onChange={(text) =>
							onChange((current) => ({ ...current, prompt: text }))
						}
					/>
				)}
				{by === "rule" ? (
					<Note>
						Write a node id or an input name, then a path:{" "}
						<code>{EXPRESSION_EXAMPLE}</code>. Put a name with a dash in
						backticks: <code>`my-input`.title</code>. Later nodes read the data
						as <code>{`{{${node.id}.data}}`}</code> or a path into it.
					</Note>
				) : (
					<Note>
						Later nodes read the data as <code>{`{{${node.id}.data}}`}</code> or
						a path into it, and why it failed as{" "}
						<code>{`{{${node.id}.note}}`}</code>.
					</Note>
				)}
			</InspectorSection>

			<InspectorSection title="Output" tab="results">
				<OutputSchemaField
					id={`${id}-output`}
					nodeId={node.id}
					output={node.output}
					required
					assist
					description="The shape of the data this node makes. The step fails when the result does not fit."
					onChange={(output) =>
						onChange((current) =>
							output === undefined ? current : { ...current, output },
						)
					}
				/>
			</InspectorSection>

			{by === "model" ? (
				<InspectorSection title="Model" tab="setup">
					<Field
						id={`${id}-decider`}
						label="Decider"
						error={
							cannot
								? "This decider cannot make a value. Choose one that can."
								: keyMissing && decider?.apiKey
									? `Add the secret ${decider.apiKey} on the Agents page, or this node cannot make a value.`
									: null
						}
						hint="The decider whose model makes the value."
					>
						<NativeSelect
							id={`${id}-decider`}
							value={node.decider}
							aria-invalid={keyMissing || cannot}
							aria-describedby={`${id}-decider-hint`}
							onChange={(event) => {
								const next = event.target.value as ValueNode["decider"];
								// A model belongs to its decider: the new one starts on its default.
								onChange((current) => ({
									...withoutField(current, "model"),
									decider: next,
								}));
							}}
						>
							{cannot && decider ? (
								<NativeSelectOption value={decider.name} disabled>
									{decider.label}
								</NativeSelectOption>
							) : null}
							{makers.map((d) => (
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
							placeholder={decider?.value?.defaultModel}
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
							{(decider?.value?.models ?? []).map((value) => (
								<option key={value} value={value} />
							))}
						</datalist>
					</Field>
				</InspectorSection>
			) : null}
		</>
	);
}
