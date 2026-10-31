import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
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
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { KnowledgeFileSheet } from "./knowledge-file-sheet";
import { knowledgeQueries } from "./queries";

/** How long the words rest before the search runs, in ms. */
const TYPING_PAUSE = 250;

/** How often the page asks again while search by meaning gets ready, in ms. */
const PREPARING_POLL = 5000;

/**
 * A search field over the project's knowledge: the files that best match
 * the words, or their meaning, each with its title, path, the heading of
 * the part found and the words found. A file opens in a sheet beside the
 * list. One quiet line says whether search finds by meaning.
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
			<MeaningLine projectId={projectId} />
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
								<ItemTitle>
									{hit.title}
									{hit.found.length === 1 && hit.found[0] === "meaning" ? (
										<Badge variant="secondary">By meaning</Badge>
									) : null}
								</ItemTitle>
								<p className="break-all text-muted-foreground text-xs">
									<span className="font-mono">{hit.path}</span>
									{hit.section ? ` · ${hit.section}` : ""}
									{hit.page ? ` · page ${hit.page}` : ""}
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

/** What the page says about search by meaning on this computer. Nothing when it is off. */
function MeaningLine({ projectId }: { projectId: string }) {
	const meaning = useQuery({
		...knowledgeQueries.meaning(projectId),
		refetchInterval: (query) =>
			query.state.data?.state === "preparing" ? PREPARING_POLL : false,
	});
	const status = meaning.data;
	if (!status || status.state === "off") return null;
	const pull = <code className="font-mono">ollama pull {status.model}</code>;
	return (
		<p className="text-muted-foreground text-sm">
			{status.state === "on" ? (
				"Search finds files by their words and by their meaning."
			) : status.state === "preparing" ? (
				<>
					Search by meaning gets ready:{" "}
					{status.total > 0
						? Math.floor((status.done / status.total) * 100)
						: 0}
					% done.
				</>
			) : status.state === "turned-off" ? (
				"Search finds words only. Search by meaning is off for this project."
			) : status.state === "no-model" ? (
				<>
					Search finds words only. To find files by their meaning too, run{" "}
					{pull}.
				</>
			) : (
				<>
					Search finds words only. To find files by their meaning too, install
					Ollama, then run {pull}.
				</>
			)}
		</p>
	);
}
