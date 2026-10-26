/**
 * The field helpers of the inspector: an agent suggests a prompt, output
 * fields, variables, outcomes, rules, an expression, a command, what a
 * checker checks, tool arguments, or the flow's description and inputs.
 * Each is a "Suggest …" button beside or under its field that opens one
 * kind of popover. Each shows nothing outside the editor of one flow.
 */
import {
	type AgentNode,
	argumentChanges,
	commandOf,
	type DecisionNode,
	type FlowNode,
	inputChanges,
	newVariables,
	outcomeChanges,
	ruleChanges,
	type Suggestion,
	type SuggestionKind,
	type TextRange,
	type ToolNode,
	type ValueNode,
	writeChanges,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Kbd, KbdGroup } from "@nightshift/ui/components/kbd";
import { SparklesIcon } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useState,
} from "react";
import { type FlowAssistant, useFlowAssistant } from "./flow-assistant";
import {
	ArgumentsPreview,
	InputsPreview,
	OutcomesPreview,
	OutputPreview,
	PromptPreview,
	RulesPreview,
	SetPreview,
	TextPreview,
} from "./previews";
import { SuggestPopover } from "./suggest-popover";

/** Cmd+I on a Mac, Ctrl+I elsewhere: opens the prompt helper from the field. */
export function isSuggestKey(event: KeyboardEvent): boolean {
	return (
		(event.metaKey || event.ctrlKey) &&
		!event.altKey &&
		!event.shiftKey &&
		event.key.toLowerCase() === "i"
	);
}

/** What the prompt helper works on: the prompt when it opened, and the selected part of it. */
export type PromptTarget = { base: string; selection?: TextRange };

/** The selected part of a text field, or undefined when nothing is selected. */
export function selectionOf(
	field: HTMLTextAreaElement | HTMLInputElement | null,
): TextRange | undefined {
	if (!field) return undefined;
	const { selectionStart: start, selectionEnd: end } = field;
	return start !== null && end !== null && start !== end
		? { start, end }
		: undefined;
}

/** The one look of every helper: an outline button with a sparkle, "Suggest …". */
function suggestButton(label: string, size: "xs" | "sm" = "xs") {
	return (
		<Button variant="outline" size={size}>
			<SparklesIcon data-icon="inline-start" />
			{label}
		</Button>
	);
}

/** What one helper says and shows: its button, its popover's words, its preview. */
type HelperCopy = {
	/** The button: "Suggest outcomes". */
	label: string;
	title: string;
	description: string;
	picks: readonly string[];
	placeholder: string;
	/** The size of the button next to it. Default xs. */
	size?: "xs" | "sm";
};

/**
 * A helper with its own open state: the button, then the popover for one
 * kind. `preview` draws what the suggestion changes, from the draft.
 */
function FieldSuggest({
	kind,
	nodeId,
	toolSchema,
	copy,
	preview,
}: {
	kind: SuggestionKind;
	nodeId?: string;
	toolSchema?: Record<string, unknown>;
	copy: HelperCopy;
	preview: (suggestion: Suggestion, assistant: FlowAssistant) => ReactNode;
}) {
	const assistant = useFlowAssistant();
	const [open, setOpen] = useState(false);
	if (!assistant) return null;
	return (
		<SuggestPopover
			assistant={assistant}
			kind={kind}
			nodeId={nodeId}
			toolSchema={toolSchema}
			open={open}
			onOpenChange={setOpen}
			trigger={suggestButton(copy.label, copy.size)}
			title={copy.title}
			description={copy.description}
			picks={copy.picks}
			placeholder={copy.placeholder}
			renderPreview={(suggestion) => preview(suggestion, assistant)}
		/>
	);
}

/**
 * "Suggest prompt": the prompt helper under the prompt field, also on
 * Cmd/Ctrl+I in the field. It rewrites the selected part, or the whole
 * prompt.
 */
export function PromptSuggest({
	nodeId,
	value,
	target,
	onOpen,
	onClose,
	field,
}: {
	nodeId: string;
	/** The prompt now. */
	value: string;
	/** Set while the popover is open. */
	target: PromptTarget | null;
	onOpen: () => void;
	onClose: () => void;
	field: RefObject<HTMLElement | null>;
}) {
	const assistant = useFlowAssistant();
	if (!assistant) return null;
	const selection = target?.selection;
	const base = target?.base ?? value;
	const node = assistant.flow.nodes.find((n) => n.id === nodeId);
	const question = node?.type === "decision" && node.by === "person";
	return (
		<div className="flex items-center gap-2">
			<SuggestPopover
				assistant={assistant}
				kind="prompt"
				nodeId={nodeId}
				open={target !== null}
				onOpenChange={(open) => (open ? onOpen() : onClose())}
				finalFocus={field}
				trigger={suggestButton(
					question ? "Suggest question" : "Suggest prompt",
				)}
				title={
					selection
						? "Rewrite the selected part"
						: question
							? "Suggest a question"
							: "Suggest a prompt"
				}
				description={
					selection
						? "The agent knows the flow's inputs, the other nodes and the variables, and uses the ones this part needs."
						: "The agent knows the flow's inputs, the other nodes and the variables. Select a part first to rewrite only that part."
				}
				picks={
					selection
						? ["Make it clearer", "Make it shorter", "Use the inputs it needs"]
						: [
								question ? "Write the question" : "Write the prompt",
								"Use the inputs it needs",
								"Make it shorter",
							]
				}
				placeholder="What should it do? For example: ask for a test plan too."
				selection={selection}
				blocked={() =>
					value === base
						? null
						: "The prompt changed after you asked. Try again to use the new text."
				}
				renderPreview={(suggestion) =>
					suggestion.kind === "prompt" ? (
						<PromptPreview
							before={
								selection ? base.slice(selection.start, selection.end) : base
							}
							after={suggestion.text}
							part={selection !== undefined}
						/>
					) : null
				}
			/>
			<KbdGroup aria-hidden="true" className="text-muted-foreground">
				<Kbd>⌘/Ctrl</Kbd>
				<Kbd>I</Kbd>
			</KbdGroup>
		</div>
	);
}

/** "Suggest fields": the output data helper, next to Add field. */
export function OutputSuggest({
	nodeId,
	output,
}: {
	nodeId: string;
	output: Record<string, unknown> | undefined;
}) {
	return (
		<FieldSuggest
			kind="output"
			nodeId={nodeId}
			copy={{
				label: "Suggest fields",
				title: "Suggest output fields",
				description:
					"The agent proposes the fields of this node's data, from its prompt and from what later nodes read.",
				picks: [
					"Fields the prompt asks for",
					"What later nodes read",
					"Keep it small",
				],
				placeholder:
					"What should the data hold? For example: a title and a list of tasks.",
			}}
			preview={(suggestion) =>
				suggestion.kind === "output" ? (
					<OutputPreview before={output} after={suggestion.output} />
				) : null
			}
		/>
	);
}

/** "Suggest variables": the Set variables helper, next to its add button. */
export function SetSuggest({ node }: { node: FlowNode }) {
	return (
		<FieldSuggest
			kind="set"
			nodeId={node.id}
			copy={{
				label: "Suggest variables",
				size: "sm",
				title: "Suggest variables",
				description:
					"The agent proposes the variables this node sets when its step ends. Apply adds the ones the flow does not have yet.",
				picks: [
					"Keep what later nodes need",
					"Count the tries",
					"Save the outcome",
				],
				placeholder:
					"What should the flow remember? For example: the pull request link.",
			}}
			preview={(suggestion, assistant) =>
				suggestion.kind === "set" ? (
					<SetPreview
						writes={writeChanges(node.set ?? [], suggestion.set)}
						variables={newVariables(assistant.flow, suggestion.variables)}
					/>
				) : null
			}
		/>
	);
}

/**
 * "Suggest outcomes" on an Agent node, "Suggest options" on a Decision:
 * names and descriptions from the prompt and from where the flow goes next.
 */
export function OutcomesSuggest({ node }: { node: AgentNode | DecisionNode }) {
	const decision = node.type === "decision";
	const noun = decision ? "option" : "outcome";
	return (
		<FieldSuggest
			kind="outcomes"
			nodeId={node.id}
			copy={
				decision
					? {
							label: "Suggest options",
							size: "sm",
							title: "Suggest options",
							description:
								"The agent proposes the options from the question and from where the flow goes next. Edges move with a renamed option.",
							picks: ["Fit the next steps", "Yes or no", "Add a way to stop"],
							placeholder:
								"What can be picked? For example: merge, ask for changes, or close.",
						}
					: {
							label: "Suggest outcomes",
							size: "sm",
							title: "Suggest outcomes",
							description:
								"The agent proposes outcomes from this node's prompt and from where the flow goes next. Edges move with a renamed outcome.",
							picks: [
								"Fit the next steps",
								"Approved or changes requested",
								"Keep pass and fail",
							],
							placeholder:
								"How can this step end? For example: fixed, cannot reproduce, or needs a person.",
						}
			}
			preview={(suggestion, assistant) =>
				suggestion.kind === "outcomes" ? (
					<OutcomesPreview
						noun={noun}
						{...outcomeChanges(assistant.flow, node.id, suggestion.outcomes)}
					/>
				) : null
			}
		/>
	);
}

/** "Suggest rules": a rule for each option of a Decision decided by a rule. */
export function RulesSuggest({ node }: { node: DecisionNode }) {
	return (
		<FieldSuggest
			kind="rules"
			nodeId={node.id}
			copy={{
				label: "Suggest rules",
				size: "sm",
				title: "Suggest rules",
				description:
					"The agent writes a rule for each option from the values of earlier nodes. The last option stays the default.",
				picks: [
					"Pass when the tests pass",
					"Use the outcome before",
					"Check the data fields",
				],
				placeholder:
					"When should each option win? For example: ship when the check exits 0.",
			}}
			preview={(suggestion, assistant) =>
				suggestion.kind === "rules" ? (
					<RulesPreview
						rows={ruleChanges(assistant.flow, node.id, suggestion.rules)}
					/>
				) : null
			}
		/>
	);
}

/** "Suggest expression": a Value node's expression, made to fit its output data. */
export function ExpressionSuggest({ node }: { node: ValueNode }) {
	return (
		<FieldSuggest
			kind="expression"
			nodeId={node.id}
			copy={{
				label: "Suggest expression",
				title: "Suggest an expression",
				description:
					"The agent writes an expression from earlier values that fits the output data of this node.",
				picks: [
					"Fit the output data",
					"Take fields from the step before",
					"Filter a list",
				],
				placeholder:
					"What should the value hold? For example: only the small tasks of the plan.",
			}}
			preview={(suggestion) =>
				suggestion.kind === "expression" ? (
					<TextPreview
						label="The expression becomes"
						before={node.expression ?? ""}
						after={suggestion.expression}
					/>
				) : null
			}
		/>
	);
}

/** "Suggest command": a Command node's command, or the one a Wait runs, from the project's scripts. */
export function CommandSuggest({ node }: { node: FlowNode }) {
	const wait = node.type === "wait";
	return (
		<FieldSuggest
			kind="command"
			nodeId={node.id}
			copy={
				wait
					? {
							label: "Suggest command",
							title: "Suggest a command",
							description:
								"The agent reads the project and proposes a command that succeeds once the wait is over.",
							picks: [
								"Wait for the checks to pass",
								"Wait for a deploy",
								"Wait for a file",
							],
							placeholder:
								"What do you wait for? For example: the checks of the pull request.",
						}
					: {
							label: "Suggest command",
							title: "Suggest a command",
							description:
								"The agent reads the project's scripts and proposes a command for this step.",
							picks: ["Run the tests", "Run the linter", "Build the project"],
							placeholder:
								"What should it run? For example: the type check of the web app.",
						}
			}
			preview={(suggestion) =>
				suggestion.kind === "command" ? (
					<TextPreview
						label="The command becomes"
						before={commandOf(node) ?? ""}
						after={suggestion.command}
					/>
				) : null
			}
		/>
	);
}

/** "Suggest what to check": the brief of the model that picks an Agent's outcome. */
export function CheckerSuggest({ node }: { node: AgentNode }) {
	return (
		<FieldSuggest
			kind="checker"
			nodeId={node.id}
			copy={{
				label: "Suggest what to check",
				title: "Suggest what to check",
				description:
					"The agent writes what the model looks for in the report before it picks an outcome.",
				picks: ["Ask for proof", "One line per outcome", "Keep it short"],
				placeholder:
					"What makes a pass? For example: the tests ran and passed.",
			}}
			preview={(suggestion) =>
				suggestion.kind === "checker" ? (
					<TextPreview
						label="What to check becomes"
						before={node.checker?.prompt ?? ""}
						after={suggestion.text}
					/>
				) : null
			}
		/>
	);
}

/** "Suggest arguments": a Tool node's arguments, from the tool's input schema. */
export function ArgumentsSuggest({
	node,
	toolSchema,
}: {
	node: ToolNode;
	/** The tool's input schema, when its MCP server listed it. */
	toolSchema: Record<string, unknown> | null;
}) {
	return (
		<FieldSuggest
			kind="arguments"
			nodeId={node.id}
			toolSchema={toolSchema ?? undefined}
			copy={{
				label: "Suggest arguments",
				title: "Suggest arguments",
				description:
					"The agent fills in the tool's arguments from the flow's inputs and earlier steps.",
				picks: [
					"Fill the required ones",
					"Use the inputs",
					"Use the step before",
				],
				placeholder:
					"What should the call send? For example: the title from the plan.",
			}}
			preview={(suggestion) =>
				suggestion.kind === "arguments" ? (
					<ArgumentsPreview
						rows={argumentChanges(node, suggestion.arguments)}
					/>
				) : null
			}
		/>
	);
}

/** "Suggest description": the flow's description, from its steps. */
export function DescriptionSuggest({ before }: { before: string }) {
	return (
		<FieldSuggest
			kind="description"
			copy={{
				label: "Suggest description",
				title: "Suggest a description",
				description:
					"The agent describes what this flow does from its steps, in one or two lines.",
				picks: [
					"Say what it makes",
					"Keep it to one line",
					"Say what it needs",
				],
				placeholder:
					"What should it say? For example: who runs this flow and when.",
			}}
			preview={(suggestion) =>
				suggestion.kind === "description" ? (
					<TextPreview
						label="The description becomes"
						before={before}
						after={suggestion.description}
					/>
				) : null
			}
		/>
	);
}

/** "Suggest inputs": the values a run asks for, from what the steps read. */
export function InputsSuggest() {
	return (
		<FieldSuggest
			kind="inputs"
			copy={{
				label: "Suggest inputs",
				size: "sm",
				title: "Suggest inputs",
				description:
					"The agent proposes the values you give when you start a run. It keeps the ones the steps use.",
				picks: [
					"Add what the steps read",
					"Describe each input",
					"Mark the required ones",
				],
				placeholder:
					"What should a run ask for? For example: the issue number.",
			}}
			preview={(suggestion, assistant) =>
				suggestion.kind === "inputs" ? (
					<InputsPreview
						rows={inputChanges(assistant.flow, suggestion.inputs)}
					/>
				) : null
			}
		/>
	);
}
