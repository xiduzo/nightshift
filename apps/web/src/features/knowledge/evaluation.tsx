import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronDownIcon,
	CircleAlertIcon,
	GaugeIcon,
	SparklesIcon,
} from "lucide-react";
import { toast } from "sonner";
import { type KnowledgeEvaluation, orpc } from "@/shared/api";
import { formatRelative } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { knowledgeMutations, knowledgeQueries } from "./queries";

/** The ways to search, as the page names them. */
const MODES = [
	{ mode: "words", label: "Words" },
	{ mode: "meaning", label: "Meaning" },
	{ mode: "both", label: "Words and meaning" },
] as const;

type Result = { found: number; recall: number; mrr: number } | null;

const percent = (recall: number) => `${Math.round(recall * 100)}%`;

/**
 * The test of the project's search: its question set against each way to
 * search, on this computer. It says whether search by meaning finds more
 * than words alone, with the numbers, and offers to turn it off when it
 * does not.
 */
export function SearchEvaluation({
	projectId,
	marked,
	mayChange,
}: {
	projectId: string;
	/** How many questions the set has. */
	marked: number;
	/** The person may turn search by meaning on or off. */
	mayChange: boolean;
}) {
	const evaluation = useQuery({
		...knowledgeQueries.evaluate(projectId),
		enabled: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const result = evaluation.data;
	return (
		<Card>
			<CardHeader>
				<CardTitle>How well search finds answers</CardTitle>
				<CardDescription>
					Test your {marked} marked {marked === 1 ? "question" : "questions"}{" "}
					against each way to search. A question counts when a right file is in
					the top 5.
				</CardDescription>
				<CardAction>
					<Button
						variant="outline"
						size="sm"
						disabled={evaluation.isFetching}
						onClick={() => void evaluation.refetch()}
					>
						{evaluation.isFetching ? (
							<Spinner data-icon="inline-start" />
						) : (
							<GaugeIcon data-icon="inline-start" />
						)}
						{result ? "Test again" : "Test search"}
					</Button>
				</CardAction>
			</CardHeader>
			{evaluation.error ? (
				<CardContent>
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>The test did not run</AlertTitle>
						<AlertDescription>{evaluation.error.message}</AlertDescription>
					</Alert>
				</CardContent>
			) : result ? (
				<CardContent className="flex flex-col gap-4">
					<Advice
						projectId={projectId}
						evaluation={result}
						mayChange={mayChange}
					/>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Search by</TableHead>
								<TableHead className="text-right">Found in the top 5</TableHead>
								<TableHead className="text-right">Recall at 5</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{MODES.map(({ mode, label }) => {
								const r: Result = result.modes[mode];
								return (
									<TableRow key={mode}>
										<TableCell>{label}</TableCell>
										<TableCell className="text-right tabular-nums">
											{r ? `${r.found} of ${result.questions}` : "Not tested"}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{r ? percent(r.recall) : ""}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
					<Ranks evaluation={result} />
					<p className="text-muted-foreground text-xs">
						Tested{" "}
						<LocalTime at={result.at}>{formatRelative(result.at)}</LocalTime> on
						this computer.
					</p>
				</CardContent>
			) : null}
		</Card>
	);
}

type Evaluation = KnowledgeEvaluation;

/** What the numbers say about search by meaning, and the switch when it does not help. */
function Advice({
	projectId,
	evaluation,
	mayChange,
}: {
	projectId: string;
	evaluation: Evaluation;
	mayChange: boolean;
}) {
	const queryClient = useQueryClient();
	const setMeaning = useMutation(
		knowledgeMutations.setMeaning({
			onSuccess: (_status, input) => {
				void queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() });
				toast.success(
					input.on
						? "Search by meaning is on for this project"
						: "Search by meaning is off for this project",
				);
			},
			onError: (error) => toast.error(`Could not save: ${error.message}`),
		}),
	);
	const { words, both } = evaluation.modes;
	const numbers =
		words && both
			? `Words and meaning found ${both.found} of ${evaluation.questions} (${percent(both.recall)}). Words alone found ${words.found} (${percent(words.recall)}).`
			: "";
	if (evaluation.advice === "unavailable") {
		const off = evaluation.meaning.state === "turned-off";
		return (
			<Alert>
				<SparklesIcon />
				<AlertTitle>
					{off
						? "Search by meaning is off for this project"
						: "Search by meaning does not work on this computer now"}
				</AlertTitle>
				<AlertDescription>
					{off
						? "Only words were tested. Turn it on to compare. It gets ready again first."
						: "Only words were tested. Test again when search by meaning is ready."}
				</AlertDescription>
				{off && mayChange ? (
					<AlertAction>
						<Button
							size="sm"
							variant="outline"
							disabled={setMeaning.isPending}
							onClick={() => setMeaning.mutate({ projectId, on: true })}
						>
							Turn on
						</Button>
					</AlertAction>
				) : null}
			</Alert>
		);
	}
	if (evaluation.advice === "too-few") {
		return (
			<Alert>
				<SparklesIcon />
				<AlertTitle>Mark more questions for a result you can trust</AlertTitle>
				<AlertDescription>
					{numbers} Night Shift decides from {evaluation.minQuestions} marked
					questions or more.
				</AlertDescription>
			</Alert>
		);
	}
	if (evaluation.advice === "keep") {
		return (
			<Alert>
				<SparklesIcon />
				<AlertTitle>Search by meaning finds more</AlertTitle>
				<AlertDescription>{numbers}</AlertDescription>
			</Alert>
		);
	}
	return (
		<Alert>
			<SparklesIcon />
			<AlertTitle>Words alone find as much</AlertTitle>
			<AlertDescription>
				{numbers} That is less than {evaluation.minGainPoints} points better.
				Turn off search by meaning to save the work of this computer.
			</AlertDescription>
			{mayChange ? (
				<AlertAction>
					<Button
						size="sm"
						variant="outline"
						disabled={setMeaning.isPending}
						onClick={() => setMeaning.mutate({ projectId, on: false })}
					>
						Turn off
					</Button>
				</AlertAction>
			) : null}
		</Alert>
	);
}

/** Where each way to search ranked each question's first right file. */
function Ranks({ evaluation }: { evaluation: Evaluation }) {
	const rank = (value: number | null) =>
		value === null ? "Not found" : `${value}`;
	return (
		<Collapsible className="flex flex-col gap-2">
			<CollapsibleTrigger
				render={<Button variant="ghost" size="sm" className="self-start" />}
			>
				<ChevronDownIcon data-icon="inline-start" />
				Rank of the first right file, per question
			</CollapsibleTrigger>
			<CollapsibleContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Question</TableHead>
							{MODES.map(({ mode, label }) => (
								<TableHead key={mode} className="text-right">
									{label}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{evaluation.rows.map((row) => (
							<TableRow key={row.query}>
								<TableCell className="max-w-0 whitespace-normal break-words">
									{row.query}
								</TableCell>
								{MODES.map(({ mode }) => (
									<TableCell key={mode} className="text-right tabular-nums">
										{evaluation.modes[mode] ? rank(row.ranks[mode]) : ""}
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CollapsibleContent>
		</Collapsible>
	);
}
