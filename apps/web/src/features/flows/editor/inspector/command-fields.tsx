/** The fields of a Command node: the command, its output, its secrets and its exit codes. */
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
import { connectionQueries } from "@/features/agents";
import { CommandSuggest } from "../../assistant/field-helpers";
import { Field, InspectorSection, Note } from "../fields";
import { SecretsField } from "../secrets-field";
import { TemplateField } from "../template-field";
import { NodeOptionsField } from "./node-options-field";

/** What a Command node keeps of its output, in the order the toggle shows them. */
const COMMAND_OUTPUTS: { value: CommandNode["output"]; label: string }[] = [
	{ value: "text", label: "Text" },
	{ value: "json", label: "JSON" },
];

export function CommandFields({
	flow,
	node,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
}: {
	flow: Flow;
	node: CommandNode;
	onChange: (change: (node: CommandNode) => CommandNode) => void;
	onRenameOutcome: (index: number, name: string) => string | null;
	onRemoveOutcome: (index: number) => void;
}) {
	const id = useId();
	// The secrets of this computer, to pick from.
	const secrets = useQuery(connectionQueries.list()).data?.secrets;
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
							Put templates in quotes, for example:{" "}
							<code className="font-mono">echo "{"{{worker.summary}}"}"</code>.
							To hand on data, write JSON to{" "}
							<code className="font-mono">"$NS_OUTPUT"</code>, for example:{" "}
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
					onChange={(command) =>
						onChange((current) => ({ ...current, command }))
					}
					action={<CommandSuggest node={node} />}
				/>
				<Field
					id={`${id}-output`}
					label="Output"
					hint={
						node.output === "json" ? (
							<>
								The command prints JSON. Later nodes read it as{" "}
								<code className="font-mono">{`{{${node.id}.data.tests}}`}</code>
								. Output that is not JSON ends on any other code. Writing to{" "}
								<code className="font-mono">"$NS_OUTPUT"</code> is safer: a
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
						aria-label="Output"
						aria-describedby={`${id}-output-hint`}
						className="w-full"
						value={[node.output]}
						onValueChange={(value) => {
							const output = value[0] as CommandNode["output"] | undefined;
							if (output) onChange((current) => ({ ...current, output }));
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

			<NodeOptionsField
				id={`${id}-exits`}
				kind="exit"
				node={node}
				min={1}
				hint='Each exit code gets its own edge. Leave the code empty on the last one to catch any other code. Without it, any other code fails the run. An exit with the code data is one the command picks: it writes {"outcome": "name"} to "$NS_OUTPUT".'
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
