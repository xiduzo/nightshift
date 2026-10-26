import type { McpServer } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	FieldDescription,
	FieldError,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Item } from "@nightshift/ui/components/item";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { LargerTextarea } from "@/shared/larger-window";
import { NameInput } from "./io/io-rows";

type Servers = Record<string, McpServer>;
type StdioServer = Extract<McpServer, { command: string }>;
type UrlServer = Extract<McpServer, { url: string }>;

/** `${NAME}`: how a value reads the daemon's environment. */
const envRef = (name: string) => `\${${name}}`;

/** The servers in their order, with `name` renamed to `next` in place. */
function renamed(servers: Servers, name: string, next: string): Servers {
	return Object.fromEntries(
		Object.entries(servers).map(([key, value]) => [
			key === name ? next : key,
			value,
		]),
	);
}

function uniqueServerName(servers: Servers): string {
	for (let n = 1; ; n++) {
		const name = n === 1 ? "server" : `server_${n}`;
		if (!Object.hasOwn(servers, name)) return name;
	}
}

/**
 * The MCP servers of an Agent node: a local command (stdio) or a URL. Flow
 * files live in the repo, so values come from the daemon's environment
 * through `${NAME}` instead of being written here.
 */
export function McpServersField({
	id,
	servers,
	onChange,
}: {
	id: string;
	servers: Servers | undefined;
	/** `undefined` when the last server goes. */
	onChange: (servers: Servers | undefined) => void;
}) {
	const entries = Object.entries(servers ?? {});
	const [focusName, setFocusName] = useState<string | null>(null);
	const set = (next: Servers) =>
		onChange(Object.keys(next).length > 0 ? next : undefined);

	return (
		<FieldSet className="gap-2" aria-describedby={`${id}-hint`}>
			<FieldLegend variant="label" className="sr-only">
				MCP servers (optional)
			</FieldLegend>
			{entries.length > 0 ? (
				<ul className="flex flex-col gap-1.5">
					{entries.map(([name, server], index) => (
						<ServerRow
							// The name can change; the row follows its place in the list.
							key={index}
							id={`${id}-${index}`}
							name={name}
							server={server}
							autoFocus={focusName === name}
							onRename={(next) => {
								if (next !== name && Object.hasOwn(servers ?? {}, next)) {
									return `Another server is named ${next}.`;
								}
								set(renamed(servers ?? {}, name, next));
								return null;
							}}
							onUpdate={(next) => set({ ...servers, [name]: next })}
							onRemove={() => {
								const { [name]: _, ...rest } = servers ?? {};
								set(rest);
							}}
						/>
					))}
				</ul>
			) : null}
			<Button
				variant="outline"
				size="sm"
				className="self-start"
				onClick={() => {
					const name = uniqueServerName(servers ?? {});
					setFocusName(name);
					set({ ...servers, [name]: { command: "", args: [], env: {} } });
				}}
			>
				<PlusIcon data-icon="inline-start" />
				Add MCP server
			</Button>
			<FieldDescription id={`${id}-hint`} className="text-xs">
				Adds tools for this node only, next to its built-in tools. Do not type
				secrets here. Write <code className="font-mono">{envRef("NAME")}</code>{" "}
				and Night Shift fills in the secret NAME.
			</FieldDescription>
		</FieldSet>
	);
}

function ServerRow({
	id,
	name,
	server,
	autoFocus,
	onRename,
	onUpdate,
	onRemove,
}: {
	id: string;
	name: string;
	server: McpServer;
	autoFocus: boolean;
	onRename: (name: string) => string | null;
	onUpdate: (server: McpServer) => void;
	onRemove: () => void;
}) {
	const isStdio = "command" in server;

	return (
		<Item
			render={<li />}
			variant="outline"
			size="xs"
			className="flex-col items-stretch gap-1.5 bg-card"
		>
			<NameInput
				id={`${id}-name`}
				name={name}
				label="Server name"
				autoFocus={autoFocus}
				onCommit={onRename}
			>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Remove ${name}`}
					title="Remove this server"
					onClick={onRemove}
				>
					<XIcon />
				</Button>
			</NameInput>
			<NativeSelect
				id={`${id}-kind`}
				aria-label={`How ${name} runs`}
				size="sm"
				className="w-full text-xs"
				value={isStdio ? "stdio" : "url"}
				onChange={(event) =>
					onUpdate(
						event.target.value === "stdio"
							? { command: "", args: [], env: {} }
							: { url: "", headers: {} },
					)
				}
			>
				<NativeSelectOption value="stdio">Local command</NativeSelectOption>
				<NativeSelectOption value="url">Remote URL</NativeSelectOption>
			</NativeSelect>
			{isStdio ? (
				<StdioFields id={id} name={name} server={server} onUpdate={onUpdate} />
			) : (
				<UrlFields id={id} name={name} server={server} onUpdate={onUpdate} />
			)}
		</Item>
	);
}

function StdioFields({
	id,
	name,
	server,
	onUpdate,
}: {
	id: string;
	name: string;
	server: StdioServer;
	onUpdate: (server: McpServer) => void;
}) {
	return (
		<>
			<Input
				id={`${id}-command`}
				aria-label={`Command of ${name}`}
				value={server.command}
				placeholder="npx -y @modelcontextprotocol/server-filesystem"
				className="h-8 font-mono text-xs"
				autoComplete="off"
				spellCheck={false}
				aria-invalid={server.command.trim() === ""}
				onChange={(event) =>
					onUpdate({ ...server, command: event.target.value })
				}
			/>
			<LinesField
				id={`${id}-args`}
				label={`Arguments of ${name}, one per line`}
				placeholder={"Arguments, one per line"}
				value={server.args ?? []}
				format={(args) => args.join("\n")}
				parse={(text) => ({
					value: text.split("\n").filter((line) => line.trim() !== ""),
					error: null,
				})}
				onChange={(args) => onUpdate({ ...server, args })}
			/>
			<LinesField
				id={`${id}-env`}
				label={`Environment of ${name}, NAME=value per line`}
				placeholder={`API_TOKEN=${envRef("MY_TOKEN")}`}
				value={server.env ?? {}}
				format={(env) =>
					Object.entries(env)
						.map(([key, value]) => `${key}=${value}`)
						.join("\n")
				}
				parse={(text) => parsePairs(text, "=")}
				onChange={(env) => onUpdate({ ...server, env })}
			/>
		</>
	);
}

function UrlFields({
	id,
	name,
	server,
	onUpdate,
}: {
	id: string;
	name: string;
	server: UrlServer;
	onUpdate: (server: McpServer) => void;
}) {
	return (
		<>
			<Input
				id={`${id}-url`}
				aria-label={`URL of ${name}`}
				type="url"
				value={server.url}
				placeholder="https://mcp.example.com/mcp"
				className="h-8 font-mono text-xs"
				autoComplete="off"
				spellCheck={false}
				aria-invalid={!URL.canParse(server.url)}
				onChange={(event) => onUpdate({ ...server, url: event.target.value })}
			/>
			<LinesField
				id={`${id}-headers`}
				label={`Headers of ${name}, Name: value per line`}
				placeholder={`Authorization: Bearer ${envRef("MY_TOKEN")}`}
				value={server.headers ?? {}}
				format={(headers) =>
					Object.entries(headers)
						.map(([key, value]) => `${key}: ${value}`)
						.join("\n")
				}
				parse={(text) => parsePairs(text, ":")}
				onChange={(headers) => onUpdate({ ...server, headers })}
			/>
		</>
	);
}

/** `KEY<sep>value` per line. Empty lines are skipped; a line without the separator is an error. */
function parsePairs(
	text: string,
	separator: "=" | ":",
): { value: Record<string, string>; error: string | null } {
	const value: Record<string, string> = {};
	for (const [index, line] of text.split("\n").entries()) {
		if (line.trim() === "") continue;
		const at = line.indexOf(separator);
		const key = at > 0 ? line.slice(0, at).trim() : "";
		if (key === "") {
			return {
				value,
				error: `Line ${index + 1} needs a name, then ${separator === "=" ? "=" : ":"} and the value.`,
			};
		}
		value[key] = line.slice(at + 1).trim();
	}
	return { value, error: null };
}

/**
 * A textarea over a structured value. Keeps what the person types and
 * commits each parse that has no error, so a half-typed line never drops.
 */
function LinesField<T>({
	id,
	label,
	placeholder,
	value,
	format,
	parse,
	onChange,
}: {
	id: string;
	label: string;
	placeholder: string;
	value: T;
	format: (value: T) => string;
	parse: (text: string) => { value: T; error: string | null };
	onChange: (value: T) => void;
}) {
	const formatted = format(value);
	const [text, setText] = useState(formatted);
	const [error, setError] = useState<string | null>(null);
	const errorId = useId();

	// Follow outside changes (an undo, another server kind), not our own
	// commits. `format` and `parse` are new on each render but never change
	// what they do: only the value matters.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	useEffect(() => {
		setText((current) =>
			format(parse(current).value) === formatted ? current : formatted,
		);
	}, [formatted]);

	return (
		<div className="flex flex-col gap-1">
			<LargerTextarea
				title={label}
				id={id}
				aria-label={label}
				value={text}
				placeholder={placeholder}
				className="max-h-40 min-h-12 font-mono text-xs"
				spellCheck={false}
				aria-invalid={error !== null}
				aria-describedby={error ? errorId : undefined}
				onChange={(event) => {
					const next = event.target.value;
					setText(next);
					const parsed = parse(next);
					setError(parsed.error);
					if (parsed.error === null) onChange(parsed.value);
				}}
			/>
			{error ? (
				<FieldError id={errorId} className="text-xs">
					{error}
				</FieldError>
			) : null}
		</div>
	);
}
