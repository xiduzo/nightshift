import { Button } from "@nightshift/ui/components/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@nightshift/ui/components/combobox";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { harnessInfo } from "@/lib/harnesses";
import { orpc } from "@/utils/orpc";

import type { HarnessName } from "./types";

/**
 * The models a harness offers: its adapter's list, plus what the CLI lists
 * itself (`opencode models`). Asked once per harness and kept a while.
 */
export function useHarnessModels(harness: HarnessName) {
	const query = useQuery({
		...orpc.harnesses.models.queryOptions({ input: { harness } }),
		staleTime: 5 * 60_000,
		meta: { quietErrors: true },
	});
	return {
		...query,
		/** The adapter's suggestions until the daemon answers. */
		models: query.data?.models ?? [...harnessInfo(harness).models],
	};
}

/**
 * A model id with autocomplete. Opening it shows every model the harness
 * offers; typing filters them. Any other id is fine too: the harness takes
 * whatever its CLI knows.
 */
export function ModelCombobox({
	id,
	harness,
	value,
	onChange,
	placeholder,
	invalid,
	describedBy,
}: {
	id: string;
	harness: HarnessName;
	value: string;
	onChange: (model: string) => void;
	placeholder?: string;
	invalid?: boolean;
	describedBy?: string;
}) {
	const { models } = useHarnessModels(harness);
	// The whole list on open; filter only once the person types.
	const [typed, setTyped] = useState(false);
	const query = value.trim().toLowerCase();
	const shown = typed
		? models.filter((m) => m.toLowerCase().includes(query))
		: models;

	return (
		<Combobox
			items={models}
			filteredItems={shown}
			filter={null}
			value={models.includes(value) ? value : null}
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
					Not in the list. {harnessInfo(harness).label} still takes any id it
					knows.
				</ComboboxEmpty>
				<ComboboxList>
					{(model: string) => (
						<ComboboxItem key={model} value={model} className="font-mono">
							{model}
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}

/** Where the model list came from, and a way to ask again. */
export function ModelSourceHint({
	harness,
	listing,
}: {
	harness: HarnessName;
	/** The CLI's listing command, if it has one. */
	listing: string | null;
}) {
	const query = useHarnessModels(harness);
	if (query.isFetching) {
		return (
			<span className="flex items-center gap-1.5">
				<Spinner className="size-3" />
				{listing ? (
					<>
						Asking <span className="font-mono">{listing}</span>…
					</>
				) : (
					"Loading the models…"
				)}
			</span>
		);
	}
	const data = query.data;
	return (
		<span>
			{query.models.length} models
			{data && data.listed > 0 && listing ? (
				<>
					, {data.listed} of them from{" "}
					<span className="font-mono">{listing}</span>
				</>
			) : null}
			. Any other id works too.
			{data?.problem ? ` ${listing} did not answer: ${data.problem}` : ""}{" "}
			<Button
				variant="link"
				size="xs"
				className="h-auto px-0 align-baseline"
				onClick={() => void query.refetch()}
			>
				Refresh
			</Button>
		</span>
	);
}
