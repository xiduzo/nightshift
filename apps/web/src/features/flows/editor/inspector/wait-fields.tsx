import type { Flow, WaitNode, WaitUntil } from "@nightshift/flows";
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

const KIND_ORDER: WaitUntil["kind"][] = [
	"duration",
	"time",
	"command",
	"signal",
];

const KIND_HINT: Record<WaitUntil["kind"], string> = {
	duration: "The step waits this long, then continues.",
	time: "The step waits until this time, then continues.",
	command: "The step runs the command until it succeeds, then continues.",
	signal:
		"The step waits until someone sends the run this signal, or a webhook of this project does.",
	any: "The step waits for the signal, and runs the command now and then in case the signal does not come.",
};

/** What a Wait node waits for, and the fields of that kind. */
export function WaitFields({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: WaitNode;
	onChange: (change: (node: WaitNode) => WaitNode) => void;
}) {
	const id = useId();
	const commandTools = useCommandToolField(node);
	// Switching the kind back and forth keeps what was typed.
	const lastUntil = useRef<Partial<Record<WaitUntil["kind"], WaitUntil>>>({});
	const setUntil = (until: WaitUntil) =>
		onChange((current) => ({ ...current, until }));
	const { until } = node;

	return (
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

			{until.kind === "command" ? (
				<>
					<TemplateField
						id={`${id}-command`}
						language="bash"
						label="Command"
						hint='Put templates in quotes: gh pr checks "{{pr}}".'
						flow={flow}
						nodeId={node.id}
						value={until.command}
						placeholder="gh pr checks 42"
						invalid={until.command.trim() === ""}
						error={commandTools.error}
						tools={commandTools.tools}
						action={<CommandSuggest node={node} />}
						onChange={(command) => setUntil({ ...until, command })}
					/>
					<Field
						id={`${id}-every`}
						label="Try every (minutes)"
						hint="The timeout below must be longer."
					>
						<PositiveIntInput
							id={`${id}-every`}
							value={until.everyMinutes}
							placeholder="5"
							describedBy={`${id}-every-hint`}
							onChange={(everyMinutes) =>
								setUntil({ ...until, everyMinutes: everyMinutes ?? 0 })
							}
						/>
					</Field>
				</>
			) : null}

			{until.kind === "signal" ? (
				<>
					<Field
						id={`${id}-name`}
						label="Signal name"
						hint="Send it from the run page, or from a schedule that waits for a webhook."
					>
						<Input
							id={`${id}-name`}
							value={until.name}
							placeholder="deploy-finished"
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
							aria-invalid={until.name.trim() === ""}
							aria-describedby={`${id}-name-hint`}
							onChange={(event) =>
								setUntil({ ...until, name: event.target.value })
							}
						/>
					</Field>
					<TemplateField
						id={`${id}-key`}
						label="Key (optional)"
						hint="Only a webhook with the same key continues this step. Without a key, any webhook does."
						flow={flow}
						nodeId={node.id}
						value={until.key ?? ""}
						placeholder="{{pr}}"
						multiline={false}
						onChange={(key) => {
							const { key: _, ...rest } = until;
							setUntil(key.trim() === "" ? rest : { ...rest, key });
						}}
					/>
				</>
			) : null}

			<Note>
				The step ends <code>done</code> when the wait is over, or{" "}
				<code>timeout</code> when the timeout under Limits runs out first. Later
				nodes can read <code>{`{{${node.id}.waited_minutes}}`}</code>
				{until.kind === "command" ? (
					<>
						{" "}
						and <code>{`{{${node.id}.log_tail}}`}</code>
					</>
				) : null}
				{until.kind === "signal" ? (
					<>
						{" "}
						and the webhook that sent the signal,{" "}
						<code>{`{{${node.id}.data.body}}`}</code>
					</>
				) : null}
				.
			</Note>
		</InspectorSection>
	);
}
