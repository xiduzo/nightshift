import { Badge } from "@nightshift/ui/components/badge";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@nightshift/ui/components/combobox";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { HarnessName } from "@/features/agents";
import { orpc } from "@/shared/api";

/**
 * A skill name with autocomplete. Opening it shows the project's own skills,
 * then every skill the harness has on this computer; typing filters them by
 * name and description. Any other name is fine too.
 */
export function SkillCombobox({
	id,
	projectId,
	harness,
	harnessLabel,
	value,
	onChange,
	placeholder,
	invalid,
	describedBy,
}: {
	id: string;
	projectId: string;
	harness: HarnessName;
	harnessLabel: string;
	value: string;
	onChange: (skill: string) => void;
	placeholder?: string;
	invalid?: boolean;
	describedBy?: string;
}) {
	const query = useQuery({
		...orpc.harnesses.skills.queryOptions({ input: { harness, projectId } }),
		staleTime: 5 * 60_000,
		meta: { quietErrors: true },
	});
	const skills = query.data ?? [];
	const names = skills.map((s) => s.name);
	const byName = new Map(skills.map((s) => [s.name, s]));
	// The whole list on open; filter only once the person types.
	const [typed, setTyped] = useState(false);
	const search = value.trim().toLowerCase();
	const shown = typed
		? skills
				.filter(
					(s) =>
						s.name.toLowerCase().includes(search) ||
						s.description?.toLowerCase().includes(search),
				)
				.map((s) => s.name)
		: names;

	return (
		<Combobox
			items={names}
			filteredItems={shown}
			filter={null}
			value={names.includes(value) ? value : null}
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
				aria-invalid={invalid || undefined}
				aria-describedby={describedBy}
			/>
			<ComboboxContent>
				<ComboboxEmpty>
					{query.isPending
						? "Loading the skills…"
						: `No skill matches. ${harnessLabel} still runs any skill it knows by this name.`}
				</ComboboxEmpty>
				<ComboboxList>
					{(name: string) => {
						const skill = byName.get(name);
						const description = skill?.description;
						return (
							<ComboboxItem
								key={name}
								value={name}
								className="flex-col items-start gap-0.5"
							>
								<span className="flex items-center gap-1.5">
									<span className="font-mono">{name}</span>
									{skill?.source === "project" ? (
										<Badge variant="secondary">Project</Badge>
									) : null}
								</span>
								{description ? (
									<span className="line-clamp-2 text-muted-foreground text-xs">
										{description}
									</span>
								) : null}
							</ComboboxItem>
						);
					}}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}
