import {
	ASK_A_MEMBER,
	type NoteToCheck,
	useCheckNotes,
} from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
} from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Progress } from "@nightshift/ui/components/progress";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CheckCheckIcon,
	CheckIcon,
	CircleAlertIcon,
	PencilIcon,
	SkipForwardIcon,
	XIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/shared/api";
import { formatRelative } from "@/shared/format";
import { PageSection } from "@/shared/page";
import { knowledgeQueries } from "../queries";

/** A note's key: its file and its text. */
const noteKey = (note: Pick<NoteToCheck, "learningId" | "note">) =>
	`${note.learningId}:${note.note}`;

/**
 * The learnings that wait in a project, one note at a time, as the inbox
 * shows Gates: the count, the progress of this visit, and what comes next.
 * True keeps a note, Not true deletes it, Change it tells one in its place.
 * Later puts a note after the others for this visit. Each answer goes out at
 * once. One that fails comes back, with a toast that says why.
 */
export function useNotesToCheck(projectId: string) {
	const learnings = useQuery(knowledgeQueries.learnings(projectId));
	const [later, setLater] = useState<string[]>([]);
	const [checked, setChecked] = useState(0);
	const failed = useCallback(
		({
			title,
			message,
			note,
		}: {
			title: string;
			message: string;
			note: NoteToCheck | null;
		}) => {
			toast.error(`${title}: ${message}`);
			// The note comes back: it no longer counts as checked.
			if (note) setChecked((now) => Math.max(0, now - 1));
		},
		[],
	);
	const check = useCheckNotes(orpc, { onFailed: failed });

	const waiting = useMemo(
		() => check.waiting(learnings.data ?? []),
		[check, learnings.data],
	);
	const queue = useMemo(
		() => [
			...waiting.filter((note) => !later.includes(noteKey(note))),
			...waiting.filter((note) => later.includes(noteKey(note))),
		],
		[waiting, later],
	);
	const runOf = useMemo(
		() =>
			new Map(
				(learnings.data ?? []).map((learning) => [learning.id, learning.runId]),
			),
		[learnings.data],
	);

	return {
		loading: learnings.isLoading,
		error: learnings.error,
		queue,
		/** Answered this visit. */
		checked,
		/** This visit's notes: those answered and those that wait. */
		total: checked + waiting.length,
		laterCount: later.filter((key) =>
			waiting.some((note) => noteKey(note) === key),
		).length,
		runOf: (note: NoteToCheck) => runOf.get(note.learningId) ?? null,
		settle: (note: NoteToCheck, decision: "keep" | "delete") => {
			setChecked((now) => now + 1);
			check.settle(note, decision);
		},
		/** Keeps the person's note, in place of `replaces` when given. */
		tell: (input: { note: string; replaces?: NoteToCheck }) => {
			// A change checks the note it replaces. A failure takes it back.
			if (input.replaces) setChecked((now) => now + 1);
			return check.tell({ projectId, ...input });
		},
		telling: check.telling,
		putOff: (note: NoteToCheck) =>
			setLater((now) => [
				...now.filter((key) => key !== noteKey(note)),
				noteKey(note),
			]),
	};
}

export type NotesToCheck = ReturnType<typeof useNotesToCheck>;

/**
 * Learnings to check: the one note that waits, as a card. The answers and
 * the progress of this visit sit in the footer of the page
 * (`LearningsFooter`), so they stay in reach under a long note.
 */
export function LearningsToCheck({ notes }: { notes: NotesToCheck }) {
	const current = notes.queue[0];
	return (
		<PageSection title="Learnings to check">
			{notes.loading ? (
				<Skeleton className="h-32 w-full rounded-xl" />
			) : notes.error && !current ? (
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>The learnings did not load</AlertTitle>
					<AlertDescription>{notes.error.message}</AlertDescription>
				</Alert>
			) : current ? (
				<NoteCard
					key={noteKey(current)}
					note={current}
					runId={notes.runOf(current)}
				/>
			) : (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<CheckCheckIcon aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>
							{notes.total === 0 ? "Nothing to check" : "All checked"}
						</EmptyTitle>
						<EmptyDescription>
							{notes.total === 0
								? "When an agent learns something, you check it here."
								: "Agents read what you kept from their next run."}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
		</PageSection>
	);
}

function NoteCard({
	note,
	runId,
}: {
	note: NoteToCheck;
	runId: string | null;
}) {
	const kept = note.nearTo.find((near) => near.kept);
	const waits = note.nearTo.find((near) => !near.kept);
	return (
		<Card>
			<CardHeader>
				<CardDescription className="tabular-nums">
					Learned {formatRelative(note.proposedAt)}
					{runId ? (
						<>
							{" · "}
							<Link
								to="/runs/$runId"
								params={{ runId }}
								className="underline underline-offset-2"
							>
								Open run
							</Link>
						</>
					) : null}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<p className="text-base whitespace-pre-wrap">{note.note}</p>
				{kept ? (
					<div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
						<span className="text-xs text-muted-foreground">
							You kept this before
						</span>
						<p className="whitespace-pre-wrap">{kept.note}</p>
					</div>
				) : waits ? (
					<p className="text-sm text-muted-foreground">
						Close to a note that also waits: “{waits.note}”
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}

/**
 * The sticky footer of the Knowledge overview while a note waits: the
 * progress of this visit, the question, and the answers.
 */
export function LearningsFooter({
	notes,
	onAnswer,
	onChange,
}: {
	notes: NotesToCheck;
	onAnswer: (note: NoteToCheck, decision: "keep" | "delete") => void;
	/** Change it: the person writes the note in the box. */
	onChange: (note: NoteToCheck) => void;
}) {
	const note = notes.queue[0];
	if (!note) return null;
	const kept = note.nearTo.some((near) => near.kept);
	const left = notes.queue.length;
	const later = (
		<Button variant="ghost" onClick={() => notes.putOff(note)}>
			<SkipForwardIcon data-icon="inline-start" />
			Later
		</Button>
	);
	const change = (
		<Button variant="outline" onClick={() => onChange(note)}>
			<PencilIcon data-icon="inline-start" />
			Change it
		</Button>
	);
	return (
		<section
			aria-label="Answer the learning"
			className="sticky bottom-0 z-10 -mx-4 mt-auto -mb-4 border-t bg-background/95 px-4 pt-3 pb-4 backdrop-blur supports-backdrop-filter:bg-background/80 md:-mx-6 md:-mb-6 md:px-6"
		>
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
				<div className="flex items-center gap-3">
					<Progress
						value={(notes.checked / Math.max(1, notes.total)) * 100}
						aria-label="Learnings checked"
						className="h-1 flex-1"
					/>
					<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
						{notes.checked + 1} of {notes.total} · {left} left
						{notes.laterCount > 0 ? ` · ${notes.laterCount} for later` : ""}
					</span>
				</div>
				{!note.mayDecide ? (
					<div className="flex flex-wrap items-center gap-2">
						<p className="mr-auto text-sm text-muted-foreground">
							{ASK_A_MEMBER}
						</p>
						{later}
					</div>
				) : (
					<div className="flex flex-wrap items-center gap-2">
						<p className="mr-auto text-sm font-medium">
							{kept ? "These are close. Which is right?" : "Is this true?"}
						</p>
						{kept ? (
							<>
								<Button onClick={() => onAnswer(note, "keep")}>
									Both are right
								</Button>
								<Button
									variant="outline"
									onClick={() => onAnswer(note, "delete")}
								>
									Only the kept one
								</Button>
								{change}
							</>
						) : (
							<>
								<Button onClick={() => onAnswer(note, "keep")}>
									<CheckIcon data-icon="inline-start" />
									True
								</Button>
								{change}
								<Button
									variant="outline"
									onClick={() => onAnswer(note, "delete")}
								>
									<XIcon data-icon="inline-start" />
									Not true
								</Button>
							</>
						)}
						{later}
					</div>
				)}
			</div>
		</section>
	);
}
