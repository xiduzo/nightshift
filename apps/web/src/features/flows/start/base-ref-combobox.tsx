import {
	Combobox,
	ComboboxCollection,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxGroup,
	ComboboxInput,
	ComboboxItem,
	ComboboxLabel,
	ComboboxList,
} from "@nightshift/ui/components/combobox";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { projectQueries } from "@/features/projects";

/** A clone can have hundreds of remote branches: show the newest per group. */
const PER_GROUP = 50;

type Group = { label: string; items: string[] };

/**
 * Where a run starts from, with autocomplete: the branches of recent runs,
 * then the clone's local and remote branches, newest first. Typing filters
 * them. Any other branch, tag or commit is fine too.
 */
export function BaseRefCombobox({
	id,
	projectId,
	value,
	onChange,
	recent = [],
	placeholder,
	describedBy,
}: {
	id: string;
	projectId: string;
	value: string;
	onChange: (ref: string) => void;
	/** Branches of this project's recent runs, shown first. */
	recent?: readonly string[];
	placeholder?: string;
	describedBy?: string;
}) {
	const branches = useQuery({
		...projectQueries.branches(projectId),
		staleTime: 60_000,
		meta: { quietErrors: true },
	});
	// The whole list on open; filter only once the person types.
	const [typed, setTyped] = useState(false);

	const seen = new Set<string>();
	const unseen = (refs: readonly string[]) =>
		refs.filter((ref) => ref !== "" && !seen.has(ref) && seen.add(ref));
	const all: Group[] = [
		{ label: "Recent runs", items: unseen(recent) },
		{ label: "Local branches", items: unseen(branches.data?.local ?? []) },
		{ label: "Remote branches", items: unseen(branches.data?.remote ?? []) },
	];
	const query = value.trim().toLowerCase();
	const groups = all
		.map((group) => ({
			...group,
			items: (typed
				? group.items.filter((ref) => ref.toLowerCase().includes(query))
				: group.items
			).slice(0, PER_GROUP),
		}))
		.filter((group) => group.items.length > 0);

	return (
		<Combobox
			items={groups}
			filter={null}
			value={seen.has(value) ? value : null}
			inputValue={value}
			onInputValueChange={(next) => {
				setTyped(true);
				onChange(next);
			}}
			onValueChange={(next: string | null) => {
				if (next) onChange(next);
			}}
			onOpenChange={(open) => {
				if (open) setTyped(false);
			}}
		>
			<ComboboxInput
				id={id}
				className="w-full font-mono"
				placeholder={placeholder}
				autoComplete="off"
				spellCheck={false}
				aria-describedby={describedBy}
			/>
			<ComboboxContent>
				<ComboboxEmpty>
					No branch with that name. A tag or a commit works too.
				</ComboboxEmpty>
				<ComboboxList>
					{(group: Group) => (
						<ComboboxGroup key={group.label} items={group.items}>
							<ComboboxLabel>{group.label}</ComboboxLabel>
							<ComboboxCollection>
								{(ref: string) => (
									<ComboboxItem key={ref} value={ref} className="font-mono">
										{ref}
									</ComboboxItem>
								)}
							</ComboboxCollection>
						</ComboboxGroup>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}
