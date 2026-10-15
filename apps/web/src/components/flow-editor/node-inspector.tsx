import {
	type AgentNode,
	type CommandNode,
	type Flow,
	type FlowNode,
	nodeIdSchema,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Textarea } from "@nightshift/ui/components/textarea";
import {
	BotIcon,
	PlayIcon,
	SquareTerminalIcon,
	Trash2Icon,
	TriangleAlertIcon,
} from "lucide-react";
import { useId, useRef, useState } from "react";

import type { Effort, PermissionMode } from "@/lib/api-types";
import { MODEL_SUGGESTIONS, templateVariables } from "@/lib/flow-draft";

import { Field, PositiveIntInput } from "./fields";

const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
	{ value: "acceptEdits", label: "Accept edits" },
	{ value: "default", label: "Ask for each tool" },
	{ value: "plan", label: "Plan only" },
	{ value: "bypassPermissions", label: "Bypass permissions" },
];

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function NodeInspector({
	flow,
	node,
	onChange,
	onRename,
	onSetStart,
	onDelete,
}: {
	flow: Flow;
	node: FlowNode;
	onChange: (change: (node: FlowNode) => FlowNode) => void;
	/** Returns an error message when the new id is taken. */
	onRename: (id: string) => string | null;
	onSetStart: () => void;
	onDelete: () => void;
}) {
	const id = useId();
	const isStart = flow.start === node.id;
	const Icon = node.type === "agent" ? BotIcon : SquareTerminalIcon;

	return (
		<div className="flex flex-col gap-4">
			<header className="flex items-center gap-2">
				<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
				<h2 className="font-medium text-sm">
					{node.type === "agent" ? "Agent node" : "Command node"}
				</h2>
				<div className="ml-auto flex items-center gap-1">
					<Button
						variant="outline"
						size="xs"
						onClick={onSetStart}
						disabled={isStart}
						title={isStart ? "The run starts here." : "Start the run here"}
					>
						<PlayIcon data-icon="inline-start" />
						{isStart ? "Start node" : "Set as start"}
					</Button>
					<Button
						variant="destructive"
						size="icon-xs"
						onClick={onDelete}
						aria-label={`Delete ${node.id}`}
						title="Delete node (Backspace)"
					>
						<Trash2Icon />
					</Button>
				</div>
			</header>

			<IdField
				key={node.id}
				id={`${id}-id`}
				nodeId={node.id}
				onRename={onRename}
			/>

			<Field
				id={`${id}-label`}
				label="Label"
				optional
				hint="Shown on the canvas."
			>
				<Input
					id={`${id}-label`}
					value={node.label ?? ""}
					placeholder={node.id}
					autoComplete="off"
					onChange={(event) => {
						const label = event.target.value;
						onChange((current) => ({ ...current, label: label || undefined }));
					}}
				/>
			</Field>

			{node.type === "agent" ? (
				<AgentFields
					flow={flow}
					node={node}
					onChange={(change) =>
						onChange((current) =>
							current.type === "agent" ? change(current) : current,
						)
					}
				/>
			) : (
				<CommandFields
					node={node}
					onChange={(change) =>
						onChange((current) =>
							current.type === "command" ? change(current) : current,
						)
					}
				/>
			)}

			<Field
				id={`${id}-timeout`}
				label="Timeout in minutes"
				optional
				hint="The step fails when one visit runs longer."
			>
				<PositiveIntInput
					id={`${id}-timeout`}
					value={node.timeoutMinutes}
					placeholder="No limit"
					describedBy={`${id}-timeout-hint`}
					onChange={(timeoutMinutes) =>
						onChange((current) => ({ ...current, timeoutMinutes }))
					}
				/>
			</Field>
		</div>
	);
}

/** Commits on blur or Enter, so the edges follow one rename and not every keystroke. */
function IdField({
	id,
	nodeId,
	onRename,
}: {
	id: string;
	nodeId: string;
	onRename: (id: string) => string | null;
}) {
	const [text, setText] = useState(nodeId);
	const [error, setError] = useState<string | null>(null);

	const commit = () => {
		const next = text.trim();
		if (next === nodeId) {
			setText(nodeId);
			setError(null);
			return;
		}
		const parsed = nodeIdSchema.safeParse(next);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Not a valid id.");
			return;
		}
		const taken = onRename(next);
		setError(taken);
	};

	return (
		<Field
			id={id}
			label="Id"
			error={error}
			hint={
				<>
					Other nodes read its outputs as{" "}
					<code className="font-mono">{`{{${nodeId}.field}}`}</code>. Renaming
					updates edges, the start, and those references.
				</>
			}
		>
			<Input
				id={id}
				value={text}
				className="font-mono"
				autoComplete="off"
				spellCheck={false}
				aria-invalid={error !== null}
				aria-describedby={`${id}-hint`}
				onChange={(event) => {
					setText(event.target.value);
					setError(null);
				}}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					} else if (event.key === "Escape") {
						setText(nodeId);
						setError(null);
					}
				}}
			/>
		</Field>
	);
}

function AgentFields({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: AgentNode;
	onChange: (change: (node: AgentNode) => AgentNode) => void;
}) {
	const id = useId();
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const variables = templateVariables(flow, node.id);

	const insertVariable = (variable: string) => {
		const textarea = promptRef.current;
		const start = textarea?.selectionStart ?? node.prompt.length;
		const end = textarea?.selectionEnd ?? node.prompt.length;
		const prompt =
			node.prompt.slice(0, start) + variable + node.prompt.slice(end);
		onChange((current) => ({ ...current, prompt }));
		requestAnimationFrame(() => {
			if (!textarea) return;
			textarea.focus();
			const cursor = start + variable.length;
			textarea.setSelectionRange(cursor, cursor);
		});
	};

	return (
		<>
			<Field
				id={`${id}-prompt`}
				label="Prompt"
				hint={
					node.skill
						? `Runs as /${node.skill} followed by the prompt.`
						: "What the agent should do. Leave it empty only when a skill is set."
				}
			>
				<Textarea
					ref={promptRef}
					id={`${id}-prompt`}
					value={node.prompt}
					placeholder="Implement the change, then report pass or fail."
					className="max-h-80 min-h-28 font-mono"
					aria-describedby={`${id}-prompt-hint`}
					onChange={(event) => {
						const prompt = event.target.value;
						onChange((current) => ({ ...current, prompt }));
					}}
				/>
			</Field>

			<details className="group/vars border bg-muted/30 text-xs" open>
				<summary className="cursor-pointer select-none px-2 py-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
					Template variables · click to insert
				</summary>
				<dl className="flex flex-col gap-1.5 border-t px-2 py-2">
					{variables.map(({ scope, variables: list }) => (
						<div key={scope} className="flex flex-col gap-1">
							<dt className="font-mono text-muted-foreground">{scope}</dt>
							<dd className="flex flex-wrap gap-1">
								{list.map((variable) => (
									<button
										key={variable}
										type="button"
										className="border bg-background px-1 py-0.5 font-mono text-[11px] outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
										onClick={() => insertVariable(variable)}
										title={`Insert ${variable}`}
									>
										{variable.slice(scope.length + 3, -2)}
									</button>
								))}
							</dd>
						</div>
					))}
				</dl>
				<p className="border-t px-2 py-1.5 text-muted-foreground">
					A node that has not run yet renders as an empty string.
				</p>
			</details>

			<Field
				id={`${id}-skill`}
				label="Skill"
				optional
				hint="A skill Claude Code already has, without the slash."
			>
				<Input
					id={`${id}-skill`}
					value={node.skill ?? ""}
					placeholder="wtf.implement-trace"
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
					aria-describedby={`${id}-skill-hint`}
					onChange={(event) => {
						const skill = event.target.value.replace(/^\//, "").trim();
						onChange((current) => ({ ...current, skill: skill || undefined }));
					}}
				/>
			</Field>

			<div className="grid grid-cols-2 gap-3">
				<Field id={`${id}-model`} label="Model">
					<Input
						id={`${id}-model`}
						list={`${id}-models`}
						value={node.model}
						autoComplete="off"
						spellCheck={false}
						aria-invalid={node.model.trim() === ""}
						onChange={(event) => {
							const model = event.target.value;
							onChange((current) => ({ ...current, model }));
						}}
					/>
					<datalist id={`${id}-models`}>
						{MODEL_SUGGESTIONS.map((value) => (
							<option key={value} value={value} />
						))}
					</datalist>
				</Field>
				<Field id={`${id}-effort`} label="Effort">
					<NativeSelect
						id={`${id}-effort`}
						value={node.effort ?? ""}
						onChange={(event) => {
							const effort = (event.target.value || undefined) as
								| Effort
								| undefined;
							onChange((current) => ({ ...current, effort }));
						}}
					>
						<NativeSelectOption value="">Model default</NativeSelectOption>
						{EFFORTS.map((value) => (
							<NativeSelectOption key={value} value={value}>
								{value}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
			</div>

			<Field id={`${id}-permission`} label="Permission mode">
				<NativeSelect
					id={`${id}-permission`}
					value={node.permissionMode}
					onChange={(event) => {
						const permissionMode = event.target.value as PermissionMode;
						onChange((current) => ({ ...current, permissionMode }));
					}}
				>
					{PERMISSION_MODES.map(({ value, label }) => (
						<NativeSelectOption key={value} value={value}>
							{label}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</Field>
			{node.permissionMode === "bypassPermissions" ? (
				<p className="-mt-2 flex items-start gap-1.5 text-status-interrupted text-xs">
					<TriangleAlertIcon
						className="mt-px size-3.5 shrink-0"
						aria-hidden="true"
					/>
					The agent runs every tool, shell commands included, without asking.
				</p>
			) : null}

			<Field
				id={`${id}-session`}
				label="Session on a later visit"
				hint={
					node.session === "fresh"
						? "A retry starts a new session with only the prompt: a tight brief."
						: "A retry continues this node's last session, with its full context."
				}
			>
				<NativeSelect
					id={`${id}-session`}
					value={node.session}
					aria-describedby={`${id}-session-hint`}
					onChange={(event) => {
						const session = event.target.value as AgentNode["session"];
						onChange((current) => ({ ...current, session }));
					}}
				>
					<NativeSelectOption value="fresh">Fresh session</NativeSelectOption>
					<NativeSelectOption value="resume">
						Resume the last session
					</NativeSelectOption>
				</NativeSelect>
			</Field>

			<p className="text-muted-foreground text-xs">
				Harness: <span className="text-foreground">Claude Code</span>. The agent
				ends with a step report: pass, fail, or needs input.
			</p>
		</>
	);
}

function CommandFields({
	node,
	onChange,
}: {
	node: CommandNode;
	onChange: (change: (node: CommandNode) => CommandNode) => void;
}) {
	const id = useId();
	return (
		<Field
			id={`${id}-command`}
			label="Command"
			hint='Runs with sh -c in the worktree. Exit 0 is pass, anything else is fail. Templates arrive as environment variables, so quote them: echo "{{worker.summary}}".'
		>
			<Textarea
				id={`${id}-command`}
				value={node.command}
				placeholder="bun run check"
				className="min-h-16 font-mono"
				spellCheck={false}
				aria-invalid={node.command.trim() === ""}
				aria-describedby={`${id}-command-hint`}
				onChange={(event) => {
					const command = event.target.value;
					onChange((current) => ({ ...current, command }));
				}}
			/>
		</Field>
	);
}
