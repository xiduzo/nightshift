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
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { connectionQueries } from "@/features/agents";
import { Field, InspectorSection, Note, PositiveIntInput } from "../fields";
import { SecretsField } from "../secrets-field";
import { TemplateField } from "../template-field";

/** The value of the scope select for the whole run: a Section id is never empty. */
const WHOLE_RUN = "";

type ReadyKind = "url" | "command";

const READY_KINDS: { value: ReadyKind; label: string }[] = [
	{ value: "url", label: "Address" },
	{ value: "command", label: "Command" },
];

export function ServiceFields({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: ServiceNode;
	onChange: (change: (node: ServiceNode) => ServiceNode) => void;
}) {
	const id = useId();
	const secrets = useQuery(connectionQueries.list()).data?.secrets;
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
				<Field id={`${id}-ready-kind`} label="Ready when">
					<ToggleGroup
						variant="outline"
						size="sm"
						spacing={0}
						aria-label="Ready when"
						className="w-full"
						value={[readyKind]}
						onValueChange={(value) => {
							const kind = value[0] as ReadyKind | undefined;
							if (!kind || kind === readyKind) return;
							setReady(({ command: _, url: __, ...rest }) =>
								kind === "url"
									? { ...rest, url: "" }
									: { ...rest, command: "" },
							);
						}}
					>
						{READY_KINDS.map((entry) => (
							<ToggleGroupItem
								key={entry.value}
								value={entry.value}
								className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
							>
								{entry.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</Field>
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
				<Field id={`${id}-every`} label="Check every (seconds)" optional>
					<PositiveIntInput
						id={`${id}-every`}
						value={node.ready.everySeconds}
						placeholder={String(DEFAULT_SERVICE_EVERY_SECONDS)}
						onChange={(everySeconds) =>
							setReady(({ everySeconds: _, ...ready }) =>
								everySeconds === undefined ? ready : { ...ready, everySeconds },
							)
						}
					/>
				</Field>
				<Field
					id={`${id}-timeout`}
					label="Give up after (minutes)"
					optional
					hint="The step ends failed when the service is not ready by then."
				>
					<PositiveIntInput
						id={`${id}-timeout`}
						value={node.ready.timeoutMinutes}
						placeholder={String(DEFAULT_SERVICE_TIMEOUT_MINUTES)}
						describedBy={`${id}-timeout-hint`}
						onChange={(timeoutMinutes) =>
							setReady(({ timeoutMinutes: _, ...ready }) =>
								timeoutMinutes === undefined
									? ready
									: { ...ready, timeoutMinutes },
							)
						}
					/>
				</Field>
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
						onChange(({ stop: _, ...current }) =>
							stop.trim() === "" ? current : { ...current, stop },
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
							onChange(({ scope: _, ...current }) =>
								value === WHOLE_RUN
									? current
									: { ...current, scope: { section: value } },
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
					onChange={(names) =>
						onChange(({ secrets: _, ...rest }) =>
							names.length > 0 ? { ...rest, secrets: names } : rest,
						)
					}
				/>
			</InspectorSection>
		</>
	);
}
