import { cliNameSchema } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxCollection,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxGroup,
	ComboboxItem,
	ComboboxLabel,
	ComboboxList,
	ComboboxValue,
	useComboboxAnchor,
} from "@nightshift/ui/components/combobox";
import {
	FieldDescription,
	FieldError,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { PlusIcon, SquareTerminalIcon, XIcon } from "lucide-react";
import { Fragment, useState } from "react";

import { missingConnectionMessage } from "../flow-draft";
import { type DaemonCliTool, missingCliToolMessage } from "./cli-tools-field";
import { connectionKind, type DaemonConnection } from "./connections-field";
import { Note } from "./fields";

/** One tool in the picker: a program (CLI tool) or an MCP server (connection). */
type ToolKey = `cli:${string}` | `mcp:${string}`;

const cliKey = (name: string): ToolKey => `cli:${name}`;
const mcpKey = (name: string): ToolKey => `mcp:${name}`;
const nameOf = (key: string) => key.slice(4);

/**
 * The tools of this computer an Agent node may use, in one list: programs
 * (CLI tools) and MCP servers (connections), both added once under Agents →
 * Tools. A name this computer does not have stays as a destructive chip, so
 * it can be removed.
 */
export function ToolsField({
	id,
	clis,
	connections,
	cliTools,
	daemonConnections,
	onChange,
}: {
	id: string;
	clis: readonly string[];
	connections: readonly string[];
	/** Undefined while they load. */
	cliTools: readonly DaemonCliTool[] | undefined;
	/** Undefined while they load. */
	daemonConnections: readonly DaemonConnection[] | undefined;
	onChange: (next: { clis: string[]; connections: string[] }) => void;
}) {
	const anchor = useComboboxAnchor();

	if (cliTools === undefined || daemonConnections === undefined) {
		return (
			<div className="flex flex-col gap-2" aria-busy="true">
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-3 w-2/3" />
			</div>
		);
	}

	const programs = cliTools.map((tool) => cliKey(tool.name));
	const servers = daemonConnections.map((c) => mcpKey(c.name));
	const known = new Set<string>([...programs, ...servers]);
	const value = [...clis.map(cliKey), ...connections.map(mcpKey)];
	const missing = value.filter((key) => !known.has(key));
	const describe = new Map<string, { kind: string; description?: string }>([
		...cliTools.map(
			(tool) =>
				[
					cliKey(tool.name),
					{ kind: "Program", description: tool.description ?? undefined },
				] as const,
		),
		...daemonConnections.map(
			(c) =>
				[
					mcpKey(c.name),
					{
						kind: `MCP server · ${connectionKind(c)}`,
						description: c.description ?? undefined,
					},
				] as const,
		),
	]);
	const missingMessage = (key: string) =>
		key.startsWith("cli:")
			? missingCliToolMessage(nameOf(key))
			: missingConnectionMessage(nameOf(key));

	if (known.size === 0 && value.length === 0) {
		return (
			<Note>
				This computer has no tools yet.{" "}
				<Link
					to="/agents"
					search={{ item: undefined }}
					className="text-foreground underline underline-offset-4 hover:text-primary"
				>
					Add one under Agents → Tools
				</Link>
				, then pick it here.
			</Note>
		);
	}

	const groups = [
		{ label: "Programs", items: programs },
		{ label: "MCP servers", items: servers },
	].filter((group) => group.items.length > 0);

	return (
		<FieldSet
			className="gap-2"
			data-invalid={missing.length > 0 ? true : undefined}
		>
			<FieldLegend variant="label" className="sr-only">
				Tools of this computer (optional)
			</FieldLegend>
			<Combobox
				multiple
				autoHighlight
				items={groups}
				value={value}
				onValueChange={(next: string[]) =>
					onChange({
						clis: next.filter((key) => key.startsWith("cli:")).map(nameOf),
						connections: next
							.filter((key) => key.startsWith("mcp:"))
							.map(nameOf),
					})
				}
				itemToStringLabel={(key: string) => nameOf(key)}
			>
				<ComboboxChips
					ref={anchor}
					className="w-full"
					aria-invalid={missing.length > 0 ? true : undefined}
				>
					<ComboboxValue>
						{(values: string[]) => (
							<Fragment>
								{values.map((key) => {
									const unknown = !known.has(key);
									return (
										<ComboboxChip
											key={key}
											className={
												unknown
													? "bg-destructive/10 font-mono text-destructive dark:bg-destructive/20"
													: "font-mono"
											}
											title={
												unknown
													? missingMessage(key)
													: describe.get(key)?.description
											}
										>
											{nameOf(key)}
										</ComboboxChip>
									);
								})}
								<ComboboxChipsInput
									id={id}
									placeholder={values.length > 0 ? "" : "Pick tools"}
									aria-describedby={`${id}-hint`}
								/>
							</Fragment>
						)}
					</ComboboxValue>
				</ComboboxChips>
				<ComboboxContent anchor={anchor}>
					<ComboboxEmpty>No tool with that name.</ComboboxEmpty>
					<ComboboxList>
						{(group: (typeof groups)[number]) => (
							<ComboboxGroup key={group.label} items={group.items}>
								<ComboboxLabel>{group.label}</ComboboxLabel>
								<ComboboxCollection>
									{(key: string) => {
										const info = describe.get(key);
										return (
											<ComboboxItem
												key={key}
												value={key}
												className="items-start"
											>
												<div className="flex min-w-0 flex-col gap-0.5">
													<span className="truncate font-mono">
														{nameOf(key)}
													</span>
													{info?.description ? (
														<span className="line-clamp-2 text-muted-foreground text-xs">
															{info.description}
														</span>
													) : null}
												</div>
											</ComboboxItem>
										);
									}}
								</ComboboxCollection>
							</ComboboxGroup>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
			{missing.map((key) => (
				<FieldError key={key} className="text-xs">
					{missingMessage(key)}
				</FieldError>
			))}
			<FieldDescription id={`${id}-hint`} className="text-xs">
				The agent runs these programs without asking, and can use these MCP
				servers. The permission mode decides about all other commands.
			</FieldDescription>
		</FieldSet>
	);
}

/**
 * Other programs the node may run: names of programs on this computer that
 * are not added under Agents → Tools. One chip per name. They go in the
 * node's one list of CLI tools, with the ones picked above.
 */
export function NodeProgramsField({
	id,
	names,
	onChange,
}: {
	id: string;
	names: readonly string[];
	onChange: (names: string[]) => void;
}) {
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);

	const add = () => {
		const name = text.trim();
		if (name === "") return;
		const parsed = cliNameSchema.safeParse(name);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Not a valid program name.");
			return;
		}
		if (names.includes(name)) {
			setError(`${name} is already in the list.`);
			return;
		}
		onChange([...names, name]);
		setText("");
		setError(null);
	};

	return (
		<FieldSet className="gap-2" data-invalid={error ? true : undefined}>
			<FieldLegend variant="label" className="text-xs">
				Other programs
			</FieldLegend>
			{names.length > 0 ? (
				<ul className="flex flex-wrap gap-1.5">
					{names.map((name) => (
						<li key={name}>
							<Badge variant="secondary" className="gap-1 pr-0.5 font-mono">
								<SquareTerminalIcon aria-hidden="true" />
								{name}
								<Button
									variant="ghost"
									size="icon-xs"
									className="size-4"
									aria-label={`Remove ${name}`}
									onClick={() =>
										onChange(names.filter((other) => other !== name))
									}
								>
									<XIcon />
								</Button>
							</Badge>
						</li>
					))}
				</ul>
			) : null}
			<div className="flex gap-2">
				<Input
					id={id}
					value={text}
					placeholder="jq"
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
					aria-invalid={error ? true : undefined}
					aria-describedby={`${id}-hint`}
					onChange={(event) => {
						setText(event.target.value);
						setError(null);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							add();
						}
					}}
				/>
				<Button variant="outline" onClick={add} disabled={text.trim() === ""}>
					<PlusIcon data-icon="inline-start" />
					Add
				</Button>
			</div>
			{error ? <FieldError className="text-xs">{error}</FieldError> : null}
			<FieldDescription id={`${id}-hint`} className="text-xs">
				Programs on this computer that are not under Agents → Tools. The name
				only, for example jq. The run does not start when this computer cannot
				find it.
			</FieldDescription>
		</FieldSet>
	);
}
