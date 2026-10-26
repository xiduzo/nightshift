import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	CircleAlertIcon,
	PlugZapIcon,
	SendIcon,
	TerminalIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import type { Connection, McpServer } from "@/shared/api";
import { LargerTextarea } from "@/shared/larger-window";
import {
	connectionMutations,
	connectionQueries,
	profileQueries,
} from "../queries";
import {
	type KeyValueRow,
	KeyValueRows,
	newRow,
	recordFrom,
	rowsFrom,
} from "./key-value-rows";
import { McpTestOutcome } from "./test-result";

const NAME = /^[a-z][a-z0-9_]{0,39}$/;

type Kind = "command" | "url";

type Draft = {
	name: string;
	description: string;
	kind: Kind;
	command: string;
	args: string;
	env: KeyValueRow[];
	url: string;
	headers: KeyValueRow[];
};

function draftFrom(connection: Connection | null, kind?: Kind): Draft {
	const server = connection?.server;
	const command = server && "command" in server ? server : null;
	const remote = server && "url" in server ? server : null;
	return {
		name: connection?.name ?? "",
		description: connection?.description ?? "",
		kind: remote ? "url" : connection ? "command" : (kind ?? "command"),
		command: command?.command ?? "",
		args: command?.args.join("\n") ?? "",
		env: rowsFrom(command?.env),
		url: remote?.url ?? "",
		headers: remote ? rowsFrom(remote.headers) : [newRow("Authorization")],
	};
}

function isUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/** The server a draft describes, or null while it is not complete. */
function serverFrom(draft: Draft): McpServer | null {
	if (draft.kind === "command") {
		const command = draft.command.trim();
		if (!command) return null;
		return {
			command,
			args: draft.args
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean),
			env: recordFrom(draft.env),
		};
	}
	const url = draft.url.trim();
	if (!isUrl(url)) return null;
	return { url, headers: recordFrom(draft.headers) };
}

/** Adds an MCP server, or edits one. `connection` null adds. */
export function ConnectionDialog({
	open,
	onOpenChange,
	connection,
	taken,
	kind,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	connection: Connection | null;
	/** Names already in use, to warn before the server does. */
	taken: string[];
	/** What a new server starts as. */
	kind?: Kind;
	/** After a save, with the name it has now. */
	onSaved?: (name: string) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
				{open ? (
					<ConnectionForm
						connection={connection}
						taken={taken}
						kind={kind}
						onDone={(name) => {
							onOpenChange(false);
							if (name) onSaved?.(name);
						}}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function ConnectionForm({
	connection,
	taken,
	kind,
	onDone,
}: {
	connection: Connection | null;
	taken: string[];
	kind?: Kind;
	/** `name`: what it was saved as. Undefined when nothing was saved. */
	onDone: (name?: string) => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState(() => draftFrom(connection, kind));
	const set = (patch: Partial<Draft>) =>
		setDraft((current) => ({ ...current, ...patch }));

	const test = useMutation(connectionMutations.test());
	// The result sits under the form; bring it into view in a scrolled dialog.
	const resultRef = useRef<HTMLDivElement>(null);
	const tested = test.data ?? test.error;
	useEffect(() => {
		if (tested) resultRef.current?.scrollIntoView({ block: "nearest" });
	}, [tested]);
	const save = useMutation(
		connectionMutations.save({
			onSuccess: (saved) => {
				toast.success(
					connection ? `Saved ${saved.name}` : `Added ${saved.name}`,
				);
				void queryClient.invalidateQueries({
					queryKey: connectionQueries.lists(),
				});
				// A rename reaches the profiles that name it.
				void queryClient.invalidateQueries({
					queryKey: profileQueries.lists(),
				});
				onDone(saved.name);
			},
		}),
	);

	const name = draft.name.trim();
	const nameInvalid = name !== "" && !NAME.test(name);
	const nameTaken = name !== connection?.name && taken.includes(name);
	const urlInvalid =
		draft.kind === "url" && draft.url.trim() !== "" && !isUrl(draft.url.trim());
	const server = serverFrom(draft);
	const canSave = NAME.test(name) && !nameTaken && server !== null;

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!canSave || !server) return;
				save.mutate({
					name,
					description: draft.description.trim() || undefined,
					server,
					previousName: connection?.name,
				});
			}}
		>
			<DialogHeader>
				<DialogTitle>
					{connection ? `Edit ${connection.name}` : "Add MCP server"}
				</DialogTitle>
				<DialogDescription>
					Add it once here. Profiles and Agent nodes can then use its tools.
				</DialogDescription>
			</DialogHeader>

			<FieldGroup className="gap-5">
				<Field data-invalid={nameInvalid || nameTaken || undefined}>
					<FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
					<Input
						id={`${id}-name`}
						value={draft.name}
						onChange={(event) => set({ name: event.target.value })}
						placeholder="issue_tracker"
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						required
						autoFocus={!connection}
						aria-invalid={nameInvalid || nameTaken || undefined}
						aria-describedby={`${id}-name-hint`}
					/>
					{nameInvalid ? (
						<FieldError id={`${id}-name-hint`}>
							Use lowercase letters, digits and _, starting with a letter. Up to
							40 characters.
						</FieldError>
					) : nameTaken ? (
						<FieldError id={`${id}-name-hint`}>
							A connection named {name} already exists.
						</FieldError>
					) : (
						<FieldDescription id={`${id}-name-hint`}>
							Profiles and Agent nodes use it by this name.
							{connection && name !== connection.name
								? " Flows that use the old name cannot run until you update their nodes."
								: null}
						</FieldDescription>
					)}
				</Field>

				<Field>
					<FieldLabel htmlFor={`${id}-description`}>
						Description{" "}
						<span className="font-normal text-muted-foreground">
							(optional)
						</span>
					</FieldLabel>
					<Input
						id={`${id}-description`}
						value={draft.description}
						onChange={(event) => set({ description: event.target.value })}
						placeholder="What the tools are for"
						autoComplete="off"
					/>
				</Field>

				<Field>
					<FieldLabel id={`${id}-kind`}>Kind</FieldLabel>
					<ToggleGroup
						variant="outline"
						size="sm"
						spacing={0}
						aria-labelledby={`${id}-kind`}
						className="w-full"
						value={[draft.kind]}
						onValueChange={(value) => {
							const kind = value[0] as Kind | undefined;
							if (kind) set({ kind });
							test.reset();
						}}
					>
						<ToggleGroupItem
							value="command"
							className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
						>
							<TerminalIcon />
							Local command
						</ToggleGroupItem>
						<ToggleGroupItem
							value="url"
							className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
						>
							<SendIcon />
							Remote URL
						</ToggleGroupItem>
					</ToggleGroup>
				</Field>

				{draft.kind === "command" ? (
					<>
						<Field>
							<FieldLabel htmlFor={`${id}-command`}>Command</FieldLabel>
							<Input
								id={`${id}-command`}
								value={draft.command}
								onChange={(event) => set({ command: event.target.value })}
								placeholder="npx"
								className="font-mono"
								autoComplete="off"
								spellCheck={false}
							/>
							<FieldDescription>
								Night Shift runs it on this computer when an agent needs its
								tools.
							</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${id}-args`}>Arguments</FieldLabel>
							<LargerTextarea
								title="Arguments"
								id={`${id}-args`}
								value={draft.args}
								onChange={(event) => set({ args: event.target.value })}
								placeholder={"-y\n@modelcontextprotocol/server-github"}
								rows={3}
								className="font-mono"
								spellCheck={false}
							/>
							<FieldDescription>One per line.</FieldDescription>
						</Field>
						<FieldSet className="gap-3">
							<FieldLegend variant="label">Environment</FieldLegend>
							<KeyValueRows
								rows={draft.env}
								onChange={(env) => set({ env })}
								keyLabel="Variable"
								keyPlaceholder="GITHUB_TOKEN"
								valuePlaceholder="${GITHUB_TOKEN}"
								addLabel="Add variable"
							/>
						</FieldSet>
					</>
				) : (
					<>
						<Field data-invalid={urlInvalid || undefined}>
							<FieldLabel htmlFor={`${id}-url`}>URL</FieldLabel>
							<Input
								id={`${id}-url`}
								value={draft.url}
								onChange={(event) => set({ url: event.target.value })}
								placeholder="https://mcp.example.com/mcp"
								className="font-mono"
								autoComplete="off"
								spellCheck={false}
								inputMode="url"
								aria-invalid={urlInvalid || undefined}
							/>
							{urlInvalid ? (
								<FieldError>Use an http or https URL.</FieldError>
							) : (
								<FieldDescription>
									The address of the MCP server. Your agents send their tool
									calls there.
								</FieldDescription>
							)}
						</Field>
						<FieldSet className="gap-3">
							<FieldLegend variant="label">Headers</FieldLegend>
							<KeyValueRows
								rows={draft.headers}
								onChange={(headers) => set({ headers })}
								keyLabel="Header"
								keyPlaceholder="Authorization"
								valuePlaceholder="Bearer ${API_TOKEN}"
								addLabel="Add header"
							/>
						</FieldSet>
					</>
				)}

				<FieldDescription>
					Do not paste a token here. Write it as{" "}
					<span className="font-mono">${"{NAME}"}</span> and save the value
					under Secrets.
				</FieldDescription>

				{test.isPending || test.data || test.error ? (
					<div ref={resultRef} className="scroll-mb-24">
						<McpTestOutcome
							pending={test.isPending}
							result={test.data}
							error={test.error}
						/>
					</div>
				) : null}

				{save.error ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>Not saved</AlertTitle>
						<AlertDescription>{save.error.message}</AlertDescription>
					</Alert>
				) : null}
			</FieldGroup>

			<DialogFooter className="sm:justify-between">
				<Button
					type="button"
					variant="outline"
					disabled={!server || test.isPending}
					onClick={() => {
						if (server) test.mutate({ server });
					}}
				>
					{test.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<PlugZapIcon data-icon="inline-start" />
					)}
					Test
				</Button>
				<div className="flex flex-col-reverse gap-2 sm:flex-row">
					<DialogClose render={<Button variant="outline" type="button" />}>
						Cancel
					</DialogClose>
					<Button type="submit" disabled={!canSave || save.isPending}>
						{save.isPending ? <Spinner data-icon="inline-start" /> : null}
						{save.isPending
							? "Saving…"
							: connection
								? "Save"
								: "Add MCP server"}
					</Button>
				</div>
			</DialogFooter>
		</form>
	);
}
