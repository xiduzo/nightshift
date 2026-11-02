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
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";

import { knowledgeFolderQueries } from "../queries";
import { Field, Note } from "./fields";
import { foldersOf } from "./knowledge-folders";

/**
 * The folders of the project's knowledge an Agent node may read: a
 * multiple Combobox with a chip per folder. A folder the knowledge does
 * not have yet stays as a chip, with a note: it gives nothing until then.
 */
export function KnowledgeFoldersField({
	id,
	projectId,
	folders,
	onChange,
}: {
	id: string;
	projectId: string;
	folders: readonly string[];
	onChange: (folders: string[]) => void;
}) {
	const anchor = useComboboxAnchor();
	const knowledge = useQuery({
		...knowledgeFolderQueries.files(projectId),
		staleTime: 30_000,
		meta: { quietErrors: true },
	});

	if (knowledge.isPending) {
		return (
			<div className="flex flex-col gap-2" aria-busy="true">
				<Skeleton className="h-9 w-full" />
			</div>
		);
	}

	const known = foldersOf(
		(knowledge.data?.files ?? []).map((file) => file.path),
	);
	const missing = folders.filter((folder) => !known.includes(folder));

	return (
		<Field
			id={id}
			label="Folders"
			hint="The agent reads, searches and finds only these folders."
		>
			{known.length === 0 && folders.length === 0 ? (
				<Note>
					The knowledge has no folders yet. Add files on the Knowledge page,
					then pick their folders here.
				</Note>
			) : (
				<Combobox
					multiple
					autoHighlight
					items={known}
					value={[...folders]}
					onValueChange={(value: string[]) => onChange(value)}
				>
					<ComboboxChips ref={anchor} className="w-full">
						<ComboboxValue>
							{(values: string[]) => (
								<Fragment>
									{values.map((folder) => (
										<ComboboxChip
											key={folder}
											className="font-mono"
											title={
												missing.includes(folder)
													? "This folder is not in the knowledge yet. The agent gets nothing from it until it is."
													: undefined
											}
										>
											{folder}
										</ComboboxChip>
									))}
									<ComboboxChipsInput
										id={id}
										placeholder={values.length > 0 ? "" : "Pick folders"}
										aria-describedby={`${id}-hint`}
									/>
								</Fragment>
							)}
						</ComboboxValue>
					</ComboboxChips>
					<ComboboxContent anchor={anchor}>
						<ComboboxEmpty>No folder with that name.</ComboboxEmpty>
						<ComboboxList>
							{(folder: string) => (
								<ComboboxItem key={folder} value={folder}>
									<span className="truncate font-mono">{folder}</span>
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			)}
			{missing.length > 0 ? (
				<Note>
					Not in the knowledge yet:{" "}
					<span className="font-mono text-foreground">
						{missing.join(", ")}
					</span>
					. The agent gets nothing from {missing.length === 1 ? "it" : "them"}{" "}
					until then.
				</Note>
			) : null}
		</Field>
	);
}
