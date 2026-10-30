import type { Flow, ToolNode } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	FieldDescription,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { connectionQueries } from "@/features/agents";
import { ArgumentsSuggest } from "../../assistant/field-helpers";
import { missingConnectionMessage } from "../../flow-draft";
import { connectionKind, type DaemonConnection } from "../connections-field";
import { Field, InspectorSection, Note } from "../fields";
import { TemplateField } from "../template-field";

/**
 * The Tool node's inspector: the connection, the tool (listed from the
 * connection when it answers, typed when it does not), and one field per
 * argument of the tool's input schema, plus any argument you add yourself.
 */
export function ToolFields({
	flow,
	node,
	connections,
	onChange,
}: {
	flow: Flow;
	node: ToolNode;
	/** The daemon's connections; undefined while they load. */
	connections: readonly DaemonConnection[] | undefined;
	onChange: (change: (node: ToolNode) => ToolNode) => void;
}) {
	const id = useId();
	const known = connections?.map((c) => c.name) ?? [];
	const picked = node.connection !== "";
	const missing =
		picked && connections !== undefined && !known.includes(node.connection);

	const noServers = connections?.length === 0 && !picked;

	const tools = useQuery({
		...connectionQueries.tools(node.connection),
		enabled: picked && !missing && connections !== undefined,
		staleTime: 60_000,
		retry: false,
	});
	const listed = tools.data?.ok ? tools.data.tools : null;
	const tool = listed?.find((t) => t.name === node.tool) ?? null;
	const cannotList =
		picked &&
		!missing &&
		!tools.isPending &&
		(tools.isError || !tools.data?.ok);

	return (
		<InspectorSection title="Tool">
			<Field
				id={`${id}-connection`}
				label="MCP server"
				error={missing ? missingConnectionMessage(node.connection) : null}
				hint={
					noServers ? undefined : (
						<>
							An MCP server you add once under{" "}
							<Link to="/agents" search={{ item: undefined }}>
								Agents → Tools
							</Link>
							.
						</>
					)
				}
			>
				{connections === undefined ? (
					<Skeleton className="h-9 w-full" aria-busy="true" />
				) : noServers ? (
					<Note>
						This computer has no MCP servers yet. Programs such as gh are not
						MCP servers. Run them in a Command node, or give them to an Agent
						node.{" "}
						<Link
							to="/agents"
							search={{ item: undefined }}
							className="text-foreground underline underline-offset-4 hover:text-primary"
						>
							Add an MCP server under Agents → Tools
						</Link>
						.
					</Note>
				) : (
					<NativeSelect
						id={`${id}-connection`}
						className="font-mono"
						value={node.connection}
						aria-invalid={!picked || missing}
						aria-describedby={`${id}-connection-hint`}
						onChange={(event) => {
							const connection = event.target.value;
							onChange((current) =>
								connection === current.connection
									? current
									: { ...current, connection, tool: "", arguments: {} },
							);
						}}
					>
						<NativeSelectOption value="">Pick an MCP server</NativeSelectOption>
						{connections.map((connection) => (
							<NativeSelectOption key={connection.name} value={connection.name}>
								{connection.name} · {connectionKind(connection)}
							</NativeSelectOption>
						))}
						{missing ? (
							<NativeSelectOption value={node.connection}>
								{node.connection} (not found)
							</NativeSelectOption>
						) : null}
					</NativeSelect>
				)}
			</Field>

			{picked ? (
				<Field
					id={`${id}-tool`}
					label="Tool"
					hint={
						tool?.description ??
						(cannotList
							? "Could not list the tools. Type the tool name."
							: tools.isPending && !missing
								? "Loading the tools…"
								: listed && listed.length === 0
									? "This MCP server has no tools."
									: undefined)
					}
				>
					{listed && listed.length > 0 ? (
						<NativeSelect
							id={`${id}-tool`}
							className="font-mono"
							value={node.tool}
							aria-invalid={node.tool === ""}
							aria-describedby={`${id}-tool-hint`}
							onChange={(event) => {
								const name = event.target.value;
								onChange((current) => ({ ...current, tool: name }));
							}}
						>
							<NativeSelectOption value="">Pick a tool</NativeSelectOption>
							{listed.map((t) => (
								<NativeSelectOption key={t.name} value={t.name}>
									{t.name}
								</NativeSelectOption>
							))}
							{node.tool !== "" && !tool ? (
								<NativeSelectOption value={node.tool}>
									{node.tool} (not listed)
								</NativeSelectOption>
							) : null}
						</NativeSelect>
					) : (
						<Input
							id={`${id}-tool`}
							value={node.tool}
							placeholder="create_issue"
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
							aria-invalid={node.tool === ""}
							aria-describedby={`${id}-tool-hint`}
							onChange={(event) => {
								const name = event.target.value;
								onChange((current) => ({ ...current, tool: name }));
							}}
						/>
					)}
				</Field>
			) : null}

			{picked && node.tool !== "" ? (
				<Arguments
					flow={flow}
					node={node}
					schema={tool?.inputSchema ?? null}
					onChange={(args) =>
						onChange((current) => ({ ...current, arguments: args }))
					}
				/>
			) : null}

			<Note>
				Later nodes read <code>{`{{${node.id}.data}}`}</code> (the tool's answer
				as JSON, with a path) and <code>{`{{${node.id}.text}}`}</code> (its
				text).
			</Note>
		</InspectorSection>
	);
}

/** One property of a tool's input schema, as the form needs it. */
type Property = {
	name: string;
	type: string;
	description: string | null;
	required: boolean;
};

/** The properties of a JSON Schema object, in schema order. */
function propertiesOf(schema: Record<string, unknown> | null): Property[] {
	const properties = schema?.properties;
	if (!properties || typeof properties !== "object") return [];
	const required = Array.isArray(schema?.required)
		? schema.required.filter((n): n is string => typeof n === "string")
		: [];
	return Object.entries(properties as Record<string, unknown>).map(
		([name, property]) => {
			const record =
				property && typeof property === "object"
					? (property as Record<string, unknown>)
					: {};
			const type = Array.isArray(record.type)
				? record.type.filter((t) => t !== "null").join(" or ")
				: typeof record.type === "string"
					? record.type
					: "any";
			return {
				name,
				type,
				description:
					typeof record.description === "string" ? record.description : null,
				required: required.includes(name),
			};
		},
	);
}

const PLACEHOLDER: Record<string, string> = {
	string: "Text, or {{plan.data.title}}",
	number: "42, or {{count}}",
	integer: "42, or {{count}}",
	boolean: "true or false",
	object: '{"key": "value"}, or {{plan.data}}',
	array: '["a", "b"], or {{plan.data.tasks}}',
};

/**
 * A template per argument: the tool's properties (required ones marked),
 * then the arguments the schema does not list, with a way to drop them,
 * and a way to add one.
 */
function Arguments({
	flow,
	node,
	schema,
	onChange,
}: {
	flow: Flow;
	node: ToolNode;
	/** The tool's input schema, when the connection listed it. */
	schema: Record<string, unknown> | null;
	onChange: (args: Record<string, string>) => void;
}) {
	const id = useId();
	const [adding, setAdding] = useState("");
	const properties = propertiesOf(schema);
	const listed = new Set(properties.map((p) => p.name));
	const extra = Object.keys(node.arguments).filter((name) => !listed.has(name));
	const trimmed = adding.trim();
	const taken = listed.has(trimmed) || Object.hasOwn(node.arguments, trimmed);

	const set = (name: string, value: string) => {
		const next = { ...node.arguments };
		if (value === "") delete next[name];
		else next[name] = value;
		onChange(next);
	};
	const remove = (name: string) => {
		const next = { ...node.arguments };
		delete next[name];
		onChange(next);
	};

	return (
		<FieldSet className="gap-4">
			<div className="flex flex-col gap-1">
				<FieldLegend variant="label" className="mb-0">
					Arguments
				</FieldLegend>
				<FieldDescription className="text-xs">
					{properties.length === 0
						? schema
							? "This tool takes no arguments."
							: "Add the arguments the tool takes. Each value is a template."
						: "Give a value for each argument. A value that is one reference keeps its JSON value."}
				</FieldDescription>
			</div>
			{properties.length > 0 || !schema ? (
				<div className="self-start">
					<ArgumentsSuggest node={node} toolSchema={schema} />
				</div>
			) : null}
			{properties.map((property) => {
				const value = node.arguments[property.name] ?? "";
				return (
					<TemplateField
						key={property.name}
						id={`${id}-${property.name}`}
						label={
							<span className="flex min-w-0 items-center gap-1.5">
								<span className="font-mono">{property.name}</span>
								<span className="font-normal text-muted-foreground">
									{property.type}
								</span>
							</span>
						}
						required={property.required}
						hint={property.description ?? undefined}
						flow={flow}
						nodeId={node.id}
						value={value}
						invalid={property.required && value.trim() === ""}
						multiline={property.type === "object" || property.type === "array"}
						className={
							property.type === "object" || property.type === "array"
								? "min-h-16"
								: undefined
						}
						placeholder={PLACEHOLDER[property.type] ?? PLACEHOLDER.string}
						onChange={(next) => set(property.name, next)}
					/>
				);
			})}
			{extra.map((name) => (
				<TemplateField
					key={name}
					id={`${id}-${name}`}
					label={
						<span className="flex min-w-0 items-center gap-1.5">
							<span className="font-mono">{name}</span>
							{schema ? (
								<span className="font-normal text-muted-foreground">
									not in the tool's list
								</span>
							) : null}
							<Button
								variant="ghost"
								size="icon-xs"
								className="ml-auto"
								aria-label={`Remove the argument ${name}`}
								title="Remove this argument"
								onClick={() => remove(name)}
							>
								<XIcon />
							</Button>
						</span>
					}
					flow={flow}
					nodeId={node.id}
					value={node.arguments[name] ?? ""}
					multiline={false}
					placeholder={PLACEHOLDER.string}
					onChange={(next) => set(name, next)}
				/>
			))}
			<div className="flex items-start gap-1.5">
				<Input
					id={`${id}-new`}
					value={adding}
					placeholder="Argument name"
					className="h-8 min-w-0 flex-1 font-mono text-xs"
					autoComplete="off"
					spellCheck={false}
					aria-label="New argument name"
					aria-invalid={trimmed !== "" && taken}
					onChange={(event) => setAdding(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter" || trimmed === "" || taken) return;
						event.preventDefault();
						onChange({ ...node.arguments, [trimmed]: "" });
						setAdding("");
					}}
				/>
				<Button
					variant="outline"
					size="sm"
					disabled={trimmed === "" || taken}
					onClick={() => {
						onChange({ ...node.arguments, [trimmed]: "" });
						setAdding("");
					}}
				>
					<PlusIcon data-icon="inline-start" />
					Add argument
				</Button>
			</div>
		</FieldSet>
	);
}
