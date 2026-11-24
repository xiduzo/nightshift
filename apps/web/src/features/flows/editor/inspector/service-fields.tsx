/** The fields of a Service node: how it starts, when it is ready, how it stops, until when it runs, and its secrets. */
import {
	DEFAULT_SERVICE_EVERY_SECONDS,
	DEFAULT_SERVICE_TIMEOUT_MINUTES,
	type Flow,
	nodesWithin,
	type ServiceNode,
	serviceSection,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import {
	connectionQueries,
	projectSecretQueries,
	spaceSecretQueries,
} from "@/features/agents";
import { SecretsField } from "./access";
import {
	type Choice,
	ChoiceField,
	Field,
	InspectorSection,
	Note,
	NumberField,
	withOptional,
} from "./form";
import { TemplateField } from "./template";

/** The value of the scope select for the whole run: a Section id is never empty. */
const WHOLE_RUN = "";

type ReadyKind = "url" | "command";

const READY_KINDS: Choice<ReadyKind>[] = [
	{ value: "url", label: "Address" },
	{ value: "command", label: "Command" },
];

export function ServiceFields({
	projectId,
	flow,
	node,
	onChange,
}: {
	projectId: string;
	flow: Flow;
	node: ServiceNode;
	onChange: (change: (node: ServiceNode) => ServiceNode) => void;
}) {
	const id = useId();
	const secrets = useQuery(connectionQueries.list()).data?.secrets;
	// The project's secrets: each step of its runs has them (ADR 13).
	const projectSecrets = useQuery({
		...projectSecretQueries.list(projectId),
		select: (list) => list.secrets.map((secret) => secret.name),
	}).data;
	// The Space's secrets: every step of its runs has them too (ADR 18).
	const spaceSecrets = useQuery({
		...spaceSecretQueries.list(),
		select: (list) => list.secrets.map((secret) => secret.name),
	}).data;
	const named = node.secrets ?? [];
	// The Sections the node is in: the service can run until the run leaves one.
	const sections = (flow.sections ?? []).filter((section) =>
		nodesWithin(flow, section).includes(node.id),
	);
	const section = serviceSection(node);
	const readyKind: ReadyKind =
		node.ready.command !== undefined ? "command" : "url";
	const setReady = (
		change: (ready: ServiceNode["ready"]) => ServiceNode["ready"],
	) => onChange((current) => ({ ...current, ready: change(current.ready) }));

	return (
		<>
			<InspectorSection title="Service">
				<TemplateField
					id={`${id}-start`}
					label="Start"
					hint="Runs in the background in the project. Put templates in quotes."
					flow={flow}
					nodeId={node.id}
					value={node.start}
					placeholder="docker compose up -d"
					language="bash"
					invalid={node.start.trim() === ""}
					onChange={(start) => onChange((current) => ({ ...current, start }))}
				/>
				<ChoiceField
					id={`${id}-ready-kind`}
					label="Ready when"
					value={readyKind}
					choices={READY_KINDS}
					onChange={(kind) =>
						setReady(({ command: _, url: __, ...rest }) =>
							kind === "url" ? { ...rest, url: "" } : { ...rest, command: "" },
						)
					}
				/>
				{readyKind === "url" ? (
					<TemplateField
						id={`${id}-ready-url`}
						label="Address"
						hint="Ready when it answers with a 2xx status."
						flow={flow}
						nodeId={node.id}
						value={node.ready.url ?? ""}
						placeholder="http://127.0.0.1:8080/health"
						multiline={false}
						invalid={(node.ready.url ?? "").trim() === ""}
						onChange={(url) => setReady((ready) => ({ ...ready, url }))}
					/>
				) : (
					<TemplateField
						id={`${id}-ready-command`}
						label="Check"
						hint={
							<>
								Ready when it exits 0. JSON it writes to{" "}
								<code className="font-mono">"$NS_OUTPUT"</code> is the step's
								data.
							</>
						}
						flow={flow}
						nodeId={node.id}
						value={node.ready.command ?? ""}
						placeholder="docker compose exec -T db pg_isready"
						language="bash"
						invalid={(node.ready.command ?? "").trim() === ""}
						onChange={(command) => setReady((ready) => ({ ...ready, command }))}
					/>
				)}
				<NumberField
					id={`${id}-every`}
					label="Check every (seconds)"
					optional
					value={node.ready.everySeconds}
					placeholder={String(DEFAULT_SERVICE_EVERY_SECONDS)}
					onChange={(everySeconds) =>
						setReady((current) =>
							withOptional(current, "everySeconds", everySeconds),
						)
					}
				/>
				<NumberField
					id={`${id}-timeout`}
					label="Give up after (minutes)"
					optional
					hint="The step ends failed when the service is not ready by then."
					value={node.ready.timeoutMinutes}
					placeholder={String(DEFAULT_SERVICE_TIMEOUT_MINUTES)}
					onChange={(timeoutMinutes) =>
						setReady((current) =>
							withOptional(current, "timeoutMinutes", timeoutMinutes),
						)
					}
				/>
				<TemplateField
					id={`${id}-stop`}
					label="Stop (optional)"
					hint="Empty: Night Shift ends the processes the start command began."
					flow={flow}
					nodeId={node.id}
					value={node.stop ?? ""}
					placeholder="docker compose down"
					language="bash"
					onChange={(stop) =>
						onChange((current) =>
							withOptional(
								current,
								"stop",
								stop.trim() === "" ? undefined : stop,
							),
						)
					}
				/>
				<Field
					id={`${id}-scope`}
					label="Stop it when"
					hint="Night Shift also stops it when the run ends, however it ends."
				>
					<NativeSelect
						id={`${id}-scope`}
						value={section ?? WHOLE_RUN}
						aria-describedby={`${id}-scope-hint`}
						onChange={(event) => {
							const value = event.target.value;
							onChange((current) =>
								withOptional(
									current,
									"scope",
									value === WHOLE_RUN ? undefined : { section: value },
								),
							);
						}}
					>
						<NativeSelectOption value={WHOLE_RUN}>
							The run ends
						</NativeSelectOption>
						{sections.map((frame) => (
							<NativeSelectOption key={frame.id} value={frame.id}>
								The run leaves {frame.label || frame.id}
							</NativeSelectOption>
						))}
						{section !== null && !sections.some((s) => s.id === section) ? (
							<NativeSelectOption value={section}>
								The run leaves {section} (not found)
							</NativeSelectOption>
						) : null}
					</NativeSelect>
				</Field>
				<Note>
					Later steps read <code>log_tail</code> for the last lines of its log.
					Every step while it runs must run on the same device.
				</Note>
			</InspectorSection>

			<InspectorSection
				title="Secrets"
				defaultOpen={named.length > 0}
				aside={
					named.length > 0 ? (
						<Badge variant="secondary" className="tabular-nums">
							{named.length}
						</Badge>
					) : null
				}
			>
				<SecretsField
					id={`${id}-secrets`}
					names={named}
					secrets={secrets}
					projectSecrets={[...(projectSecrets ?? []), ...(spaceSecrets ?? [])]}
					onChange={(names) =>
						onChange((current) =>
							withOptional(
								current,
								"secrets",
								names.length > 0 ? names : undefined,
							),
						)
					}
				/>
			</InspectorSection>
		</>
	);
}
