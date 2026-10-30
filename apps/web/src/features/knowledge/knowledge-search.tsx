import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@nightshift/ui/components/input-group";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { CodeView, languageOfPath } from "@/shared/code";
import { formatSize } from "@/shared/format";
import { knowledgeQueries } from "./queries";

/** How long the words rest before the search runs, in ms. */
const TYPING_PAUSE = 250;

/**
 * A search field over the project's knowledge: the files that best match
 * the words, each with its title, path and the words found. A file opens
 * in a sheet beside the list.
 */
export function KnowledgeSearch({ projectId }: { projectId: string }) {
	const [text, setText] = useState("");
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState<string | null>(null);

	useEffect(() => {
		const timer = setTimeout(() => setQuery(text.trim()), TYPING_PAUSE);
		return () => clearTimeout(timer);
	}, [text]);

	const hits = useQuery({
		...knowledgeQueries.search(projectId, query),
		enabled: query !== "",
		placeholderData: keepPreviousData,
	});

	return (
		<div className="flex flex-col gap-3">
			<InputGroup>
				<InputGroupAddon>
					<SearchIcon aria-hidden="true" />
				</InputGroupAddon>
				<InputGroupInput
					type="text"
					value={text}
					onChange={(event) => setText(event.target.value)}
					placeholder="Search the knowledge, for example: deploy"
					aria-label="Search the knowledge"
				/>
				{text !== "" ? (
					<InputGroupAddon align="inline-end">
						{hits.isFetching ? <Spinner /> : null}
						<InputGroupButton
							size="icon-xs"
							aria-label="Clear the search"
							onClick={() => {
								setText("");
								setQuery("");
							}}
						>
							<XIcon aria-hidden="true" />
						</InputGroupButton>
					</InputGroupAddon>
				) : null}
			</InputGroup>
			{query === "" ? null : hits.error ? (
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>The search did not work</AlertTitle>
					<AlertDescription>{hits.error.message}</AlertDescription>
				</Alert>
			) : !hits.data ? (
				<Skeleton className="h-16 w-full" />
			) : hits.data.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>No file matches</EmptyTitle>
						<EmptyDescription>
							Try other words, or fewer. Put words in quotes to find them
							together.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ItemGroup className="gap-2">
					{hits.data.map((hit) => (
						<Item key={hit.path} variant="outline">
							<ItemContent>
								<ItemTitle>{hit.title}</ItemTitle>
								<p className="break-all font-mono text-muted-foreground text-xs">
									{hit.path}
								</p>
								<ItemDescription>
									{hit.snippet.map((part, index) =>
										part.match ? (
											<mark
												key={`${index}:${part.text}`}
												className="rounded-sm bg-primary/15 px-0.5 text-foreground"
											>
												{part.text}
											</mark>
										) : (
											<span key={`${index}:${part.text}`}>{part.text}</span>
										),
									)}
								</ItemDescription>
							</ItemContent>
							<ItemActions>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setOpen(hit.path)}
								>
									Open file
								</Button>
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
			)}
			<KnowledgeFileSheet
				projectId={projectId}
				path={open}
				onClose={() => setOpen(null)}
			/>
		</div>
	);
}

/** One file of the knowledge, in a sheet beside the results. */
function KnowledgeFileSheet({
	projectId,
	path,
	onClose,
}: {
	projectId: string;
	path: string | null;
	onClose: () => void;
}) {
	const file = useQuery({
		...knowledgeQueries.read(projectId, path ?? ""),
		enabled: path !== null,
	});
	return (
		<Sheet open={path !== null} onOpenChange={(next) => !next && onClose()}>
			<SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
				<SheetHeader>
					<SheetTitle>{file.data?.title ?? path}</SheetTitle>
					<SheetDescription className="break-all font-mono text-xs">
						{path}
						{file.data ? ` · ${formatSize(file.data.size)}` : ""}
					</SheetDescription>
				</SheetHeader>
				{file.error ? (
					<Alert variant="destructive" className="mx-4 w-auto">
						<CircleAlertIcon />
						<AlertTitle>The file did not open</AlertTitle>
						<AlertDescription>{file.error.message}</AlertDescription>
					</Alert>
				) : file.isLoading ? (
					<Skeleton className="mx-4 h-40" />
				) : !file.data ? (
					<Alert className="mx-4 w-auto">
						<CircleAlertIcon />
						<AlertTitle>This file is gone</AlertTitle>
						<AlertDescription>
							A sync changed the knowledge. Search again.
						</AlertDescription>
					</Alert>
				) : (
					<>
						{file.data.truncated ? (
							<p className="mx-4 text-muted-foreground text-sm">
								This file is large. You see its start.
							</p>
						) : null}
						<CodeView
							code={file.data.text}
							language={languageOfPath(file.data.path)}
							className="mx-4 mb-4 min-h-0 w-auto flex-1"
							contentClassName="max-h-none"
						/>
					</>
				)}
			</SheetContent>
		</Sheet>
	);
}
