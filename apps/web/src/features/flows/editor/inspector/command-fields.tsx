/** The fields of a Command node: the command, its output and its shape, its secrets and its exit codes. */
import {
	type CommandNode,
	commandExits,
	DATA_EXIT_CODE,
	type Flow,
	type NodeOption,
	STANDARD_EXIT_CODES,
	uniqueOptionName,
	withOptions,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { useId } from "react";
import {
	connectionQueries,
	projectSecretQueries,
	spaceSecretQueries,
} from "@/features/agents";
import { CommandSuggest } from "../../assistant/field-helpers";
import { useCommandToolField } from "../cli-tools-field";
import { Field, InspectorSection, Note } from "../fields";
import { SecretsField } from "../secrets-field";
import { TemplateField } from "../template-field";
import { DataShapeSection } from "./data-shape-section";
import { NodeOptionsField } from "./node-options-field";

/** What a Command node keeps of its output, in the order the toggle shows them. */
const COMMAND_OUTPUTS: { value: CommandNode["stdout"]; label: string }[] = [
	{ value: "text", label: "Text" },
	{ value: "json", label: "JSON" },
];

export function CommandFields({
	projectId,
	flow,
	node,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
}: {
	projectId: string;
	flow: Flow;
	node: CommandNode;
	onChange: (change: (node: CommandNode) => CommandNode) => void;
	onRenameOutcome: (index: number, name: string) => string | null;
	onRemoveOutcome: (index: number) => void;
}) {
	const id = useId();
	const commandTools = useCommandToolField(node);
	// The secrets of this computer, to pick from.
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
	const exits = commandExits(node);
	const catchAll = exits.findIndex((exit) => exit.code === undefined);
	const unusedCode = () => {
		let code = 3;
		while (exits.some((exit) => exit.code === code)) code++;
		return code;
	};
	// A new code goes before the catch-all, which must stay last.
	const addExit = (exit: NodeOption) =>
		onChange((current) => {
			const list = commandExits(current);
			const at = list.findIndex((entry) => entry.code === undefined);
			const next =
				exit.code === undefined || at === -1
					? [...list, exit]
					: [...list.slice(0, at), exit, ...list.slice(at)];
			return withOptions(current, next);
		});
	const standard = STANDARD_EXIT_CODES.filter(
		(entry) => !exits.some((exit) => exit.code === entry.code),
	);

	return (
		<>
			<InspectorSection title="Command">
				<TemplateField
					id={`${id}-command`}
					label="Command"
					hint={
						<>
							Put templates in quotes:{" "}
							<code className="font-mono">echo "{"{{worker.summary}}"}"</code>.
							To give data to later nodes, write JSON to{" "}
							<code className="font-mono">"$NS_OUTPUT"</code>:{" "}
							<code className="font-mono">
								echo '{"{"}"count": 3{"}"}' {">"} "$NS_OUTPUT"
							</code>
							.
						</>
					}
					flow={flow}
					nodeId={node.id}
					value={node.command}
					placeholder="bun run check"
					language="bash"
					className="min-h-20"
					invalid={node.command.trim() === ""}
					error={commandTools.error}
					tools={commandTools.tools}
					onChange={(command) =>
						onChange((current) => ({ ...current, command }))
					}
					action={<CommandSuggest node={node} />}
				/>
				<Field
					id={`${id}-stdout`}
					label="What it prints"
					hint={
						node.stdout === "json" ? (
							<>
								The command prints JSON. Later nodes read it as{" "}
								<code className="font-mono">{`{{${node.id}.data.tests}}`}</code>
								. Output that is not JSON ends on any other code. Write to{" "}
								<code className="font-mono">"$NS_OUTPUT"</code> instead, and a
								stray echo cannot break it.
							</>
						) : (
							<>
								Later nodes read the last lines as{" "}
								<code className="font-mono">{`{{${node.id}.log_tail}}`}</code>,
								and the JSON the command writes to{" "}
								<code className="font-mono">"$NS_OUTPUT"</code> as{" "}
								<code className="font-mono">{`{{${node.id}.data}}`}</code>.
							</>
						)
					}
				>
					<ToggleGroup
						variant="outline"
						size="sm"
						spacing={0}
						aria-label="What it prints"
						aria-describedby={`${id}-stdout-hint`}
						className="w-full"
						value={[node.stdout]}
						onValueChange={(value) => {
							const stdout = value[0] as CommandNode["stdout"] | undefined;
							if (stdout) onChange((current) => ({ ...current, stdout }));
						}}
					>
						{COMMAND_OUTPUTS.map((entry) => (
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
			</InspectorSection>

			<DataShapeSection node={node} onChange={onChange} />

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
						onChange(({ secrets: _, ...rest }) =>
							names.length > 0 ? { ...rest, secrets: names } : rest,
						)
					}
				/>
			</InspectorSection>

			<NodeOptionsField
				id={`${id}-exits`}
				kind="exit"
				node={node}
				min={1}
				hint='Each exit code gets its own edge. Leave the last code empty to catch any other code. Without it, any other code fails the run. For the code data, the command writes {"outcome": "name"} to "$NS_OUTPUT".'
				onChange={onChange}
				onRenameOutcome={onRenameOutcome}
				onRemoveOutcome={onRemoveOutcome}
				onCode={(index, code) =>
					onChange((current) =>
						withOptions(
							current,
							commandExits(current).map((exit, at) => {
								if (at !== index) return exit;
								const { code: _, ...rest } = exit;
								return code === undefined ? rest : { ...rest, code };
							}),
						),
					)
				}
				addControl={
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button variant="outline" size="sm" className="self-start" />
							}
						>
							<PlusIcon data-icon="inline-start" />
							Add exit code
							<ChevronDownIcon data-icon="inline-end" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-72">
							{standard.length > 0 ? (
								<DropdownMenuGroup>
									<DropdownMenuLabel>Common exit codes</DropdownMenuLabel>
									{standard.map((entry) => (
										<DropdownMenuItem
											key={entry.code}
											className="items-start"
											onClick={() =>
												addExit({
													...entry,
													name: uniqueOptionName(exits, entry.name),
												})
											}
										>
											<span className="w-8 shrink-0 font-mono tabular-nums">
												{entry.code}
											</span>
											<span className="flex min-w-0 flex-col">
												<span className="font-mono">{entry.name}</span>
												<span className="text-muted-foreground text-xs">
													{entry.description}
												</span>
											</span>
										</DropdownMenuItem>
									))}
								</DropdownMenuGroup>
							) : null}
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								<DropdownMenuItem
									onClick={() =>
										addExit({
											name: uniqueOptionName(exits, "exit"),
											code: unusedCode(),
										})
									}
								>
									<span className="w-8 shrink-0" />
									Another code
								</DropdownMenuItem>
								<DropdownMenuItem
									className="items-start"
									onClick={() =>
										addExit({
											name: uniqueOptionName(exits, "picked"),
											code: DATA_EXIT_CODE,
											description: "The command picks it in its data.",
										})
									}
								>
									<span className="w-8 shrink-0 font-mono">data</span>
									<span className="flex min-w-0 flex-col">
										<span>Picked by the command</span>
										<span className="text-muted-foreground text-xs">
											It writes {'{"outcome": "picked"}'} to "$NS_OUTPUT".
										</span>
									</span>
								</DropdownMenuItem>
								{catchAll === -1 ? (
									<DropdownMenuItem
										onClick={() =>
											addExit({
												name: uniqueOptionName(exits, "other"),
												description: "Any other exit code.",
											})
										}
									>
										<span className="w-8 shrink-0 font-mono">any</span>
										Any other code
									</DropdownMenuItem>
								) : null}
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				}
			>
				<Note>
					Later nodes read the code as <code>{`{{${node.id}.exit_code}}`}</code>
					.
				</Note>
			</NodeOptionsField>
		</>
	);
}
