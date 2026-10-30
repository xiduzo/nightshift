/** The fields of a Value node: who makes the value, and its schema. */
import { type Flow, type ValueNode, withValueBy } from "@nightshift/flows";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useId } from "react";
import { LargerTextarea } from "@/shared/larger-window";
import { ExpressionSuggest } from "../../assistant/field-helpers";
import { VALUE_BY_ICON } from "../../canvas/node-type";
import { Field, InspectorSection, Note } from "../fields";
import { OutputSchemaField } from "../output-schema-field";
import { TemplateField } from "../template-field";
import { ModelSettings } from "./model-settings";

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
	projectId,
	flow,
	node,
	onChange,
}: {
	projectId: string;
	flow: Flow;
	node: ValueNode;
	onChange: (change: (node: ValueNode) => ValueNode) => void;
}) {
	const id = useId();
	const { by } = node;
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
							? "An expression reads the values of earlier nodes and inputs. It uses no model and costs nothing."
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
						<LargerTextarea
							title="Expression"
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
						hint="Say what to make, and give the context it needs."
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
				<ModelSettings projectId={projectId} node={node} onChange={onChange} />
			) : null}
		</>
	);
}
