import type { Flow, WaitCommand, WaitNode, WaitUntil } from "@nightshift/flows";
import { emptyUntil } from "@nightshift/flows";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { useId, useRef } from "react";
import { CommandSuggest } from "../../assistant/field-helpers";
import { WAIT_KINDS } from "../../flow-draft";
import { useCommandToolField } from "../cli-tools-field";
import { Field, InspectorSection, Note, PositiveIntInput } from "../fields";
import { TemplateField } from "../template-field";
import { NodeOptionsField } from "./node-options-field";

const KIND_ORDER: WaitUntil["kind"][] = [
	"duration",
	"time",
	"command",
	"signal",
	"any",
];

const KIND_HINT: Record<WaitUntil["kind"], string> = {
	duration: "The step waits this long, then continues.",
	time: "The step waits until this time, then continues.",
	command: "The step runs the command until it succeeds, then continues.",
	signal:
		"The step waits until someone sends the run this signal, or a webhook of this project does.",
	any: "The step waits for the signal, and runs the command now and then in case the signal does not come.",
};

/** Who picks a Wait's outcome, by what it waits for. Unset: nothing can. */
const OUTCOMES_HINT: Partial<Record<WaitUntil["kind"], string>> = {
	command:
		'The command picks one when it writes {"outcome": "name"} to "$NS_OUTPUT". Each outcome gets its own edge.',
	signal:
		"A webhook ends the wait on the first outcome whose rule holds. A webhook that matches no rule does not continue the step.",
	any: 'The command picks one with {"outcome": "name"} in "$NS_OUTPUT". A webhook picks the first outcome whose rule holds.',
};

/** What a Wait node waits for, the fields of that kind, and its outcomes. */
export function WaitFields({
	flow,
	node,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
}: {
	flow: Flow;
	node: WaitNode;
	onChange: (change: (node: WaitNode) => WaitNode) => void;
	onRenameOutcome: (index: number, name: string) => string | null;
	onRemoveOutcome: (index: number) => void;
}) {
	const id = useId();
	// Switching the kind back and forth keeps what was typed.
	const lastUntil = useRef<Partial<Record<WaitUntil["kind"], WaitUntil>>>({});
	const setUntil = (until: WaitUntil) =>
		onChange((current) => ({ ...current, until }));
	const { until } = node;
	const outcomesHint = OUTCOMES_HINT[until.kind];
	const polls = until.kind === "command" || until.kind === "any";
	const hasSignal = until.kind === "signal" || until.kind === "any";

	return (
		<>
			<InspectorSection title="Wait">
				<Field id={`${id}-kind`} label="Wait for" hint={KIND_HINT[until.kind]}>
					<NativeSelect
						id={`${id}-kind`}
						value={until.kind}
						aria-describedby={`${id}-kind-hint`}
						onChange={(event) => {
							const kind = event.target.value as WaitUntil["kind"];
							if (kind === until.kind) return;
							lastUntil.current[until.kind] = until;
							setUntil(lastUntil.current[kind] ?? emptyUntil(kind));
						}}
					>
						{KIND_ORDER.map((kind) => (
							<NativeSelectOption key={kind} value={kind}>
								{WAIT_KINDS[kind]}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>

				{until.kind === "duration" ? (
					<Field
						id={`${id}-minutes`}
						label="Minutes"
						hint="A whole number above 0."
					>
						<PositiveIntInput
							id={`${id}-minutes`}
							value={until.minutes}
							placeholder="15"
							describedBy={`${id}-minutes-hint`}
							onChange={(minutes) =>
								setUntil({ ...until, minutes: minutes ?? 0 })
							}
						/>
					</Field>
				) : null}

				{until.kind === "time" ? (
					<TemplateField
						id={`${id}-at`}
						label="Time"
						hint="A time of day, such as 07:00, means the next one on the clock of this computer. Or give a date and time: 2026-10-18T07:00."
						flow={flow}
						nodeId={node.id}
						value={until.at}
						placeholder="07:00"
						multiline={false}
						invalid={until.at.trim() === ""}
						onChange={(at) => setUntil({ ...until, at })}
					/>
				) : null}

				{until.kind === "signal" ? (
					<SignalFields
						id={id}
						flow={flow}
						node={node}
						signal={until}
						onChange={(signal) => setUntil({ ...signal, kind: "signal" })}
					/>
				) : null}

				{until.kind === "command" ? (
					<CommandFields
						id={id}
						flow={flow}
						node={node}
						command={until}
						onChange={(command) => setUntil({ ...command, kind: "command" })}
					/>
				) : null}

				{until.kind === "any" ? (
					<>
						<SignalFields
							id={id}
							flow={flow}
							node={node}
							signal={until.signal}
							onChange={(signal) => setUntil({ ...until, signal })}
						/>
						<CommandFields
							id={id}
							flow={flow}
							node={node}
							command={until.command}
							onChange={(command) => setUntil({ ...until, command })}
						/>
					</>
				) : null}

				<Note>
					The step ends {node.outcomes ? "on one of its outcomes, " : null}
					<code>done</code> when the wait is over, or <code>timeout</code> when
					the timeout under Limits runs out first. Later nodes can read{" "}
					<code>{`{{${node.id}.waited_minutes}}`}</code>
					{polls ? (
						<>
							, <code>{`{{${node.id}.log_tail}}`}</code>
						</>
					) : null}
					{polls || hasSignal ? (
						<>
							{" "}
							and the data of the {polls ? "command" : "webhook"}
							{polls && hasSignal ? " or the webhook" : null},{" "}
							<code>{`{{${node.id}.data}}`}</code>
						</>
					) : null}
					.
				</Note>
			</InspectorSection>

			{outcomesHint !== undefined || node.outcomes ? (
				<NodeOptionsField
					id={`${id}-outcomes`}
					kind="outcome"
					node={node}
					min={0}
					rules={hasSignal}
					rulePlaceholder='event.body.conclusion = "success"'
					hint={
						outcomesHint ??
						"A Wait for a duration or a time ends done. Remove these outcomes."
					}
					onChange={onChange}
					onRenameOutcome={onRenameOutcome}
					onRemoveOutcome={onRemoveOutcome}
				/>
			) : null}
		</>
	);
}

/** The signal a Wait waits for: its name and its key. */
function SignalFields({
	id,
	flow,
	node,
	signal,
	onChange,
}: {
	id: string;
	flow: Flow;
	node: WaitNode;
	signal: { name: string; key?: string };
	onChange: (signal: { name: string; key?: string }) => void;
}) {
	return (
		<>
			<Field
				id={`${id}-name`}
				label="Signal name"
				hint="Send it from the run page, or from a schedule that waits for a webhook."
			>
				<Input
					id={`${id}-name`}
					value={signal.name}
					placeholder="deploy-finished"
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
					aria-invalid={signal.name.trim() === ""}
					aria-describedby={`${id}-name-hint`}
					onChange={(event) =>
						onChange({ ...signal, name: event.target.value })
					}
				/>
			</Field>
			<TemplateField
				id={`${id}-key`}
				label="Key (optional)"
				hint="Only a webhook with the same key continues this step. Without a key, any webhook does."
				flow={flow}
				nodeId={node.id}
				value={signal.key ?? ""}
				placeholder="{{pr}}"
				multiline={false}
				onChange={(key) => {
					const { key: _, ...rest } = signal;
					onChange(key.trim() === "" ? rest : { ...rest, key });
				}}
			/>
		</>
	);
}

/** The command a Wait runs, and how often. */
function CommandFields({
	id,
	flow,
	node,
	command,
	onChange,
}: {
	id: string;
	flow: Flow;
	node: WaitNode;
	command: WaitCommand;
	onChange: (command: WaitCommand) => void;
}) {
	const commandTools = useCommandToolField(node);
	return (
		<>
			<TemplateField
				id={`${id}-command`}
				language="bash"
				label="Command"
				hint='Put templates in quotes: gh pr checks "{{pr}}".'
				flow={flow}
				nodeId={node.id}
				value={command.command}
				placeholder="gh pr checks 42"
				invalid={command.command.trim() === ""}
				error={commandTools.error}
				tools={commandTools.tools}
				action={<CommandSuggest node={node} />}
				onChange={(text) => onChange({ ...command, command: text })}
			/>
			<Field
				id={`${id}-every`}
				label="Try every (minutes)"
				hint="The timeout below must be longer."
			>
				<PositiveIntInput
					id={`${id}-every`}
					value={command.everyMinutes}
					placeholder="5"
					describedBy={`${id}-every-hint`}
					onChange={(everyMinutes) =>
						onChange({ ...command, everyMinutes: everyMinutes ?? 0 })
					}
				/>
			</Field>
		</>
	);
}
