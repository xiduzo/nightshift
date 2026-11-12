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
import { useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, SearchIcon, XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { KnowledgeFileSheet } from "./knowledge-file-sheet";
import { knowledgeQueries } from "./queries";
import { useKnowledgeHits } from "./use-knowledge-hits";

/** How often the page asks again while search by meaning gets ready or stopped, in ms. A look is also what tries a stopped one again. */
const PREPARING_POLL = 5000;

/**
 * A search field over the project's knowledge: the files that best match
 * the words, or their meaning, each with its title, path, the heading of
 * the part found and the words found. A file opens in a sheet beside the
 * list. One quiet line says whether search finds by meaning.
 */
export function KnowledgeSearch({
	projectId,
	idle,
}: {
	projectId: string;
	/** Shows while nothing is searched. */
	idle?: ReactNode;
}) {
	const { text, setText, query, hits, clear } = useKnowledgeHits(projectId);
	const [open, setOpen] = useState<string | null>(null);

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
					placeholder="Search your files, for example: deploy"
					aria-label="Search your files"
				/>
				{text !== "" ? (
					<InputGroupAddon align="inline-end">
						{hits.isFetching ? <Spinner /> : null}
						<InputGroupButton
							size="icon-xs"
							aria-label="Clear the search"
							onClick={clear}
						>
							<XIcon aria-hidden="true" />
						</InputGroupButton>
					</InputGroupAddon>
				) : null}
			</InputGroup>
			<MeaningLine projectId={projectId} />
			{query === "" ? (
				idle
			) : hits.error ? (
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

/** What the page says about search by meaning, and which Ollama does it. Nothing when it is off. */
function MeaningLine({ projectId }: { projectId: string }) {
	const meaning = useQuery({
		...knowledgeQueries.meaning(projectId),
		refetchInterval: (query) => {
			const state = query.state.data?.state;
			return state === "preparing" ||
				state === "downloading" ||
				state === "failed"
				? PREPARING_POLL
				: false;
		},
	});
	const status = meaning.data;
	if (!status || status.state === "off") return null;
	const where = status.where ? `at ${status.where}` : "on this computer";
	const done =
		status.total > 0 ? Math.floor((status.done / status.total) * 100) : 0;
	return (
		<p className="text-muted-foreground text-sm">
			{status.state === "on" ? (
				"Search finds files by their words and by their meaning."
			) : status.state === "preparing" ? (
				<>Search by meaning gets ready: {done}% done.</>
			) : status.state === "failed" ? (
				<>
					Search by meaning stopped at {done}%. Night Shift tries again each
					minute, and search finds words until then. If this stays, restart
					Ollama {where}.
				</>
			) : status.state === "turned-off" ? (
				"Search finds words only. Search by meaning is off for this project."
			) : status.state === "downloading" ? (
				<>
					Ollama {where} downloads {status.model}: {status.percent ?? 0}% done.
					Search finds words until then.
				</>
			) : status.state === "no-model" ? (
				<>
					Search finds words only. Ollama {where} does not have {status.model}.
					Download it on the Settings page.
				</>
			) : status.where ? (
				<>
					Search finds words only. Ollama at {status.where} does not answer.
					Check the Ollama address on the Settings page.
				</>
			) : (
				<>
					Search finds words only. Ollama does not answer on this computer. To
					find files by their meaning too, open Meaning search on the Settings
					page.
				</>
			)}
		</p>
	);
}
