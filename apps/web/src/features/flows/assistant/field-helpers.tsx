/**
 * The field helpers of the node inspector: a prompt, the output fields and
 * the variable writes, each suggested by an agent in a popover beside the
 * field. Each shows nothing outside the editor of one flow.
 */
import {
	type FlowNode,
	newVariables,
	type TextRange,
	writeChanges,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { InputGroupButton } from "@nightshift/ui/components/input-group";
import { Kbd, KbdGroup } from "@nightshift/ui/components/kbd";
import { SparklesIcon } from "lucide-react";
import { type KeyboardEvent, type RefObject, useState } from "react";
import { useFlowAssistant } from "./flow-assistant";
import { OutputPreview, PromptPreview, SetPreview } from "./previews";
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

/**
 * The prompt helper: an icon button in the prompt field that opens the
 * popover beside it. It rewrites the selected part, or the whole prompt.
 */
export function PromptSuggest({
	nodeId,
	value,
	target,
	onOpen,
	onClose,
	anchor,
	field,
}: {
	nodeId: string;
	/** The prompt now. */
	value: string;
	/** Set while the popover is open. */
	target: PromptTarget | null;
	onOpen: () => void;
	onClose: () => void;
	anchor: RefObject<HTMLElement | null>;
	field: RefObject<HTMLElement | null>;
}) {
	const assistant = useFlowAssistant();
	if (!assistant) return null;
	const selection = target?.selection;
	const base = target?.base ?? value;
	return (
		<SuggestPopover
			assistant={assistant}
			kind="prompt"
			nodeId={nodeId}
			open={target !== null}
			onOpenChange={(open) => (open ? onOpen() : onClose())}
			anchor={anchor}
			finalFocus={field}
			trigger={
				<InputGroupButton
					size="icon-xs"
					className="ml-auto"
					aria-label="Suggest with an agent"
				>
					<SparklesIcon />
				</InputGroupButton>
			}
			tooltip={
				<span className="flex items-center gap-2">
					Suggest with an agent
					<KbdGroup>
						<Kbd>⌘/Ctrl</Kbd>
						<Kbd>I</Kbd>
					</KbdGroup>
				</span>
			}
			title={selection ? "Rewrite the selected part" : "Suggest a prompt"}
			description={
				selection
					? "The agent knows the flow's inputs, the other nodes and the variables, and uses the ones this part needs."
					: "The agent knows the flow's inputs, the other nodes and the variables. Select a part of the prompt first to rewrite only that part."
			}
			picks={
				selection
					? ["Make it clearer", "Make it shorter", "Use the inputs it needs"]
					: ["Write the prompt", "Use the inputs it needs", "Make it shorter"]
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
	const assistant = useFlowAssistant();
	const [open, setOpen] = useState(false);
	if (!assistant) return null;
	return (
		<SuggestPopover
			assistant={assistant}
			kind="output"
			nodeId={nodeId}
			open={open}
			onOpenChange={setOpen}
			trigger={
				<Button variant="outline" size="xs">
					<SparklesIcon data-icon="inline-start" />
					Suggest fields
				</Button>
			}
			title="Suggest output fields"
			description="The agent proposes the fields of this node's data, from its prompt and from what later nodes read."
			picks={[
				"Fields the prompt asks for",
				"What later nodes read",
				"Keep it small",
			]}
			placeholder="What should the data hold? For example: a title and a list of tasks."
			renderPreview={(suggestion) =>
				suggestion.kind === "output" ? (
					<OutputPreview before={output} after={suggestion.output} />
				) : null
			}
		/>
	);
}

/** "Suggest variables": the Set variables helper, next to its add button. */
export function SetSuggest({ node }: { node: FlowNode }) {
	const assistant = useFlowAssistant();
	const [open, setOpen] = useState(false);
	if (!assistant) return null;
	return (
		<SuggestPopover
			assistant={assistant}
			kind="set"
			nodeId={node.id}
			open={open}
			onOpenChange={setOpen}
			trigger={
				<Button variant="outline" size="sm">
					<SparklesIcon data-icon="inline-start" />
					Suggest variables
				</Button>
			}
			title="Suggest variables"
			description="The agent proposes the variables this node sets when its step ends. Apply adds the ones the flow does not have yet."
			picks={[
				"Keep what later nodes need",
				"Count the tries",
				"Save the outcome",
			]}
			placeholder="What should the flow remember? For example: the pull request link."
			renderPreview={(suggestion) =>
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
