import type { AppRouterClient } from "@nightshift/api/routers/index";
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
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
import { Skeleton } from "@nightshift/ui/components/skeleton";
import type { InferClientOutputs } from "@orpc/client";
import { Link } from "@tanstack/react-router";
import { Fragment } from "react";

import { missingConnectionMessage } from "@/lib/flow-draft";

import { Note } from "./fields";

/** A connection on this daemon, as `connections.list` returns it. */
export type DaemonConnection =
	InferClientOutputs<AppRouterClient>["connections"]["list"]["connections"][number];

/** How a connection's server runs, in the words of the Connections page. */
export function connectionKind(connection: DaemonConnection): string {
	return "command" in connection.server ? "Local command" : "Remote URL";
}

/**
 * The connections an Agent node names: MCP servers defined once on this
 * daemon. A multiple Combobox with a chip per name; a name the daemon does
 * not have stays as a destructive chip, so it can be removed.
 */
export function ConnectionsField({
	id,
	names,
	connections,
	onChange,
}: {
	id: string;
	names: readonly string[];
	/** The daemon's connections; undefined while they load. */
	connections: readonly DaemonConnection[] | undefined;
	onChange: (names: string[]) => void;
}) {
	const anchor = useComboboxAnchor();

	if (connections === undefined) {
		return (
			<div className="flex flex-col gap-2" aria-busy="true">
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-3 w-2/3" />
			</div>
		);
	}

	const known = connections.map((connection) => connection.name);
	const missing = names.filter((name) => !known.includes(name));
	const byName = new Map(connections.map((c) => [c.name, c]));

	if (connections.length === 0 && names.length === 0) {
		return (
			<Note>
				This daemon has no connections yet.{" "}
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

	return (
		<FieldSet
			className="gap-2"
			data-invalid={missing.length > 0 ? true : undefined}
		>
			<FieldLegend variant="label" className="sr-only">
				Connections (optional)
			</FieldLegend>
			<Combobox
				multiple
				autoHighlight
				items={known}
				value={[...names]}
				onValueChange={(value: string[]) => onChange(value)}
			>
				<ComboboxChips
					ref={anchor}
					className="w-full"
					aria-invalid={missing.length > 0 ? true : undefined}
				>
					<ComboboxValue>
						{(values: string[]) => (
							<Fragment>
								{values.map((name) => {
									const unknown = !known.includes(name);
									return (
										<ComboboxChip
											key={name}
											className={
												unknown
													? "bg-destructive/10 font-mono text-destructive dark:bg-destructive/20"
													: "font-mono"
											}
											title={
												unknown
													? missingConnectionMessage(name)
													: (byName.get(name)?.description ?? undefined)
											}
										>
											{name}
										</ComboboxChip>
									);
								})}
								<ComboboxChipsInput
									id={id}
									placeholder={values.length > 0 ? "" : "Pick connections"}
									aria-describedby={`${id}-hint`}
								/>
							</Fragment>
						)}
					</ComboboxValue>
				</ComboboxChips>
				<ComboboxContent anchor={anchor}>
					<ComboboxEmpty>No connection with that name.</ComboboxEmpty>
					<ComboboxList>
						{(name: string) => {
							const connection = byName.get(name);
							return (
								<ComboboxItem key={name} value={name} className="items-start">
									<div className="flex min-w-0 flex-col gap-0.5">
										<span className="flex items-baseline gap-2">
											<span className="truncate font-mono">{name}</span>
											<span className="shrink-0 text-muted-foreground text-xs">
												{connection ? connectionKind(connection) : null}
											</span>
										</span>
										{connection?.description ? (
											<span className="line-clamp-2 text-muted-foreground text-xs">
												{connection.description}
											</span>
										) : null}
									</div>
								</ComboboxItem>
							);
						}}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
			{missing.map((name) => (
				<FieldError key={name} className="text-xs">
					{missingConnectionMessage(name)}
				</FieldError>
			))}
			<FieldDescription id={`${id}-hint`} className="text-xs">
				MCP servers defined once under{" "}
				<Link to="/agents" search={{ item: undefined }}>
					Agents → Tools
				</Link>
				. Secrets come from the keychain or the daemon's environment.
			</FieldDescription>
		</FieldSet>
	);
}
