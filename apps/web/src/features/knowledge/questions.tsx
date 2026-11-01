import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@nightshift/ui/components/combobox";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/shared/api";
import { formatRelative } from "@/shared/format";
import { PageSection } from "@/shared/page";
import { LocalTime } from "@/shared/time";
import { SearchEvaluation } from "./evaluation";
import { knowledgeMutations, knowledgeQueries } from "./queries";

/** The files a search found that the table shows, best first. */
const SHOWN_HITS = 3;

/**
 * "Questions agents asked": what agents searched for in the knowledge,
 * and what they found. A person marks the file that answers a question:
 * the question joins the project's question set, which the evaluation
 * runs.
 */
export function AskedQuestions({
	projectId,
	files,
	mayChange,
}: {
	projectId: string;
	/** Every file of the knowledge, by path: what can answer. */
	files: string[];
	/** The person may mark questions and turn search by meaning on or off. */
	mayChange: boolean;
}) {
	const questions = useQuery(knowledgeQueries.questions(projectId));
	if (questions.error) {
		return (
			<Alert variant="destructive">
				<CircleAlertIcon />
				<AlertTitle>The questions did not load</AlertTitle>
				<AlertDescription>{questions.error.message}</AlertDescription>
			</Alert>
		);
	}
	const asked = questions.data?.asked ?? [];
	const marked = questions.data?.set.length ?? 0;
	return (
		<PageSection
			title="Questions agents asked"
			description={
				!mayChange
					? "What agents searched for, and what they found."
					: marked > 0
						? `Mark the file that answers a question. ${marked} marked ${marked === 1 ? "question is" : "questions are"} in your question set.`
						: "Mark the file that answers a question. Marked questions test how well search finds answers."
			}
		>
			{marked > 0 ? (
				<SearchEvaluation
					projectId={projectId}
					marked={marked}
					mayChange={mayChange}
				/>
			) : null}
			<Card className="py-0">
				<CardContent className="px-0">
					{questions.isLoading ? (
						<div className="flex flex-col gap-2 p-6">
							<Skeleton className="h-8 w-full" />
							<Skeleton className="h-8 w-full" />
						</div>
					) : asked.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyTitle>No questions yet</EmptyTitle>
								<EmptyDescription>
									When an agent searches this knowledge, its question shows
									here.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="pl-6">Question</TableHead>
									<TableHead>Found</TableHead>
									<TableHead className="pr-6">Answer</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{asked.map((question) => (
									<TableRow key={question.query}>
										<TableCell className="max-w-0 whitespace-normal py-3 pl-6 align-top">
											<div className="flex flex-col gap-1">
												<span className="break-words">{question.query}</span>
												<LocalTime
													at={question.lastAt}
													className="text-muted-foreground text-xs"
												>
													{question.times === 1
														? `Asked ${formatRelative(question.lastAt)}`
														: `Asked ${question.times} times, last ${formatRelative(question.lastAt)}`}
												</LocalTime>
											</div>
										</TableCell>
										<TableCell className="max-w-0 whitespace-normal py-3 align-top">
											<FoundFiles hits={question.hits} />
										</TableCell>
										<TableCell className="w-72 py-3 pr-6 align-top">
											<Answer
												projectId={projectId}
												query={question.query}
												answers={question.answers}
												choices={choicesFor(question.hits, files)}
												mayChange={mayChange}
											/>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</PageSection>
	);
}

type Hit = { path: string; found: ("words" | "meaning")[] };

/** The files a question found first, then every other file. */
function choicesFor(hits: readonly Hit[], files: readonly string[]): string[] {
	const found = hits.map((hit) => hit.path).filter((p) => files.includes(p));
	return [...new Set([...found, ...files])];
}

/** The first files a search found, and which it found only by meaning. */
function FoundFiles({ hits }: { hits: readonly Hit[] }) {
	if (hits.length === 0) {
		return <span className="text-muted-foreground text-sm">Nothing</span>;
	}
	const more = hits.length - SHOWN_HITS;
	return (
		<ul className="flex flex-col gap-1">
			{hits.slice(0, SHOWN_HITS).map((hit) => (
				<li key={hit.path} className="flex flex-wrap items-center gap-2">
					<span className="break-all font-mono text-xs">{hit.path}</span>
					{hit.found.length === 1 && hit.found[0] === "meaning" ? (
						<Badge variant="outline">By meaning</Badge>
					) : null}
				</li>
			))}
			{more > 0 ? (
				<li className="text-muted-foreground text-xs">{more} more</li>
			) : null}
		</ul>
	);
}

/** The file that answers a question: a choice, or the marked file and a way to take it out. */
function Answer({
	projectId,
	query,
	answers,
	choices,
	mayChange,
}: {
	projectId: string;
	query: string;
	answers: string[] | null;
	choices: string[];
	mayChange: boolean;
}) {
	const queryClient = useQueryClient();
	const [typed, setTyped] = useState("");
	const mark = useMutation(
		knowledgeMutations.markQuestion({
			onSuccess: (_set, input) => {
				void queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() });
				toast.success(
					input.answers.length > 0
						? "Added to your question set"
						: "Taken out of your question set",
				);
			},
			onError: (error) => toast.error(`Could not save: ${error.message}`),
		}),
	);
	if (answers && answers.length > 0) {
		return (
			<div className="flex items-start gap-2">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					{answers.map((path) => (
						<span key={path} className="break-all font-mono text-xs">
							{path}
						</span>
					))}
					<Badge variant="secondary">In question set</Badge>
				</div>
				{mayChange ? (
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Take this question out of the question set"
						disabled={mark.isPending}
						onClick={() => mark.mutate({ projectId, query, answers: [] })}
					>
						<XIcon />
					</Button>
				) : null}
			</div>
		);
	}
	if (!mayChange) {
		return <span className="text-muted-foreground text-sm">Not marked</span>;
	}
	const needle = typed.trim().toLowerCase();
	const shown = needle
		? choices.filter((path) => path.toLowerCase().includes(needle))
		: choices;
	return (
		<Combobox
			items={choices}
			filteredItems={shown.slice(0, 50)}
			filter={null}
			value={null}
			inputValue={typed}
			onInputValueChange={setTyped}
			onValueChange={(path: string | null) => {
				if (path) mark.mutate({ projectId, query, answers: [path] });
			}}
			disabled={mark.isPending || choices.length === 0}
		>
			<ComboboxInput
				className="w-full"
				placeholder="Choose the file that answers"
				aria-label={`The file that answers: ${query}`}
				autoComplete="off"
				spellCheck={false}
			/>
			<ComboboxContent>
				<ComboboxEmpty>No file has these words in its path.</ComboboxEmpty>
				<ComboboxList>
					{(path: string) => (
						<ComboboxItem key={path} value={path}>
							<span className="break-all font-mono text-xs">{path}</span>
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}
