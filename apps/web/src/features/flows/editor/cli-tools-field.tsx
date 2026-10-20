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
import { Link } from "@tanstack/react-router";
import { Fragment } from "react";

import type { CliTool } from "@/shared/api";

import { Note } from "./fields";

/** A CLI tool on this computer, as `cliTools.list` returns it. */
export type DaemonCliTool = CliTool;

/** What the editor says about a CLI tool Night Shift does not have. */
export function missingCliToolMessage(name: string): string {
	return `There is no CLI tool named ${name}. The run does not start. Add it under Agents → Tools, or remove it here.`;
}

/**
 * The CLI tools an Agent node may run: programs added once under Agents →
 * Tools. A multiple Combobox with a chip per name; a name Night Shift does
 * not have stays as a destructive chip, so it can be removed.
 */
export function CliToolsField({
	id,
	names,
	tools,
	onChange,
}: {
	id: string;
	names: readonly string[];
	/** The CLI tools; undefined while they load. */
	tools: readonly DaemonCliTool[] | undefined;
	onChange: (names: string[]) => void;
}) {
	const anchor = useComboboxAnchor();

	if (tools === undefined) {
		return (
			<div className="flex flex-col gap-2" aria-busy="true">
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-3 w-2/3" />
			</div>
		);
	}

	const known = tools.map((tool) => tool.name);
	const missing = names.filter((name) => !known.includes(name));
	const byName = new Map(tools.map((tool) => [tool.name, tool]));

	if (tools.length === 0 && names.length === 0) {
		return (
			<Note>
				There are no CLI tools yet.{" "}
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
				CLI tools (optional)
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
													? missingCliToolMessage(name)
													: (byName.get(name)?.description ?? undefined)
											}
										>
											{name}
										</ComboboxChip>
									);
								})}
								<ComboboxChipsInput
									id={id}
									placeholder={values.length > 0 ? "" : "Pick CLI tools"}
									aria-describedby={`${id}-hint`}
								/>
							</Fragment>
						)}
					</ComboboxValue>
				</ComboboxChips>
				<ComboboxContent anchor={anchor}>
					<ComboboxEmpty>No CLI tool with that name.</ComboboxEmpty>
					<ComboboxList>
						{(name: string) => {
							const description = byName.get(name)?.description;
							return (
								<ComboboxItem key={name} value={name} className="items-start">
									<div className="flex min-w-0 flex-col gap-0.5">
										<span className="truncate font-mono">{name}</span>
										{description ? (
											<span className="line-clamp-2 text-muted-foreground text-xs">
												{description}
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
					{missingCliToolMessage(name)}
				</FieldError>
			))}
			<FieldDescription id={`${id}-hint`} className="text-xs">
				The agent can run these programs without asking. The permission mode
				decides about all other commands.
			</FieldDescription>
		</FieldSet>
	);
}
