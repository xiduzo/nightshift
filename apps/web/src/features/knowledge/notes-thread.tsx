import {
	ASK_A_MEMBER,
	type NoteToCheck,
	useCheckNotes,
} from "@nightshift/client";
import { Bubble, BubbleContent } from "@nightshift/ui/components/bubble";
import { Button } from "@nightshift/ui/components/button";
import {
	Message,
	MessageAvatar,
	MessageContent,
	MessageGroup,
} from "@nightshift/ui/components/message";
import { Progress } from "@nightshift/ui/components/progress";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CheckIcon,
	MoonIcon,
	PencilIcon,
	SkipForwardIcon,
	XIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/shared/api";
import { formatRelative } from "@/shared/format";
import { PageSection } from "@/shared/page";
import { knowledgeQueries } from "./queries";

/** How many answers of this visit the thread shows above the question. */
const SAID_SHOWN = 6;

/** What happened in the thread this visit, oldest first. */
export type Said =
	| {
			kind: "answer";
			key: string;
			/** The note Night Shift asked about. */
			note: string;
			/** The person's answer, as they would say it. */
			answer: string;
	  }
	| {
			kind: "told";
			key: string;
			/** What the person told. */
			text: string;
			/** What Night Shift did with it. */
			reply: string;
	  };

/** A note's key in the thread: its file and its text. */
export const noteKey = (note: Pick<NoteToCheck, "learningId" | "note">) =>
	`${note.learningId}:${note.note}`;

/**
 * The learnings that wait in a project, one note at a time, as the inbox
 * shows Gates: the count, the progress of this visit, and what comes next.
 * True keeps a note, Not true deletes it, Change it tells one in its place.
 * Later puts a note after the others for this visit. Each answer goes out at
 * once. One that fails comes back, with a toast that says why.
 */
export function useNotesToCheck(
	projectId: string,
	onFailed: (key: string) => void,
) {
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
			if (!note) return;
			// The note comes back: it no longer counts as checked.
			setChecked((now) => Math.max(0, now - 1));
			onFailed(noteKey(note));
		},
		[onFailed],
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

/** A message of Night Shift in the thread. */
function FromNightShift({ children }: { children: ReactNode }) {
	return (
		<Message>
			<MessageAvatar className="size-8">
				<MoonIcon aria-hidden="true" className="size-4" />
			</MessageAvatar>
			<MessageContent>{children}</MessageContent>
		</Message>
	);
}

/** A message of the person in the thread. */
function FromYou({ children }: { children: ReactNode }) {
	return (
		<Message align="end">
			<MessageContent>
				<Bubble>
					<BubbleContent className="whitespace-pre-wrap">
						{children}
					</BubbleContent>
				</Bubble>
			</MessageContent>
		</Message>
	);
}

/**
 * Learnings to check: one note at a time, as a conversation, with a count
 * and the progress of this visit. What you told and answered this visit
 * shows above the note that waits.
 */
export function NotesThread({
	notes,
	said,
	onAnswer,
	onChange,
}: {
	notes: NotesToCheck;
	said: readonly Said[];
	onAnswer: (
		note: NoteToCheck,
		decision: "keep" | "delete",
		answer: string,
	) => void;
	/** Change it: the person writes the note in the box. */
	onChange: (note: NoteToCheck) => void;
}) {
	const current = notes.queue[0];
	const left = notes.queue.length;
	return (
		<PageSection
			title="Learnings to check"
			actions={
				<span className="text-sm text-muted-foreground tabular-nums">
					{left === 0
						? "All checked"
						: `${left} left${notes.laterCount > 0 ? ` · ${notes.laterCount} for later` : ""}`}
				</span>
			}
		>
			{notes.total > 0 ? (
				<Progress
					value={(notes.checked / notes.total) * 100}
					aria-label="Notes checked"
					className="-mt-2 h-1"
				/>
			) : null}
			<MessageGroup className="gap-4">
				{said.slice(-SAID_SHOWN).map((one) => (
					<div key={one.key} className="flex flex-col gap-2">
						{one.kind === "answer" ? (
							<>
								<div className="opacity-60">
									<FromNightShift>
										<Bubble variant="muted">
											<BubbleContent>{one.note}</BubbleContent>
										</Bubble>
									</FromNightShift>
								</div>
								<FromYou>{one.answer}</FromYou>
							</>
						) : (
							<>
								<FromYou>{one.text}</FromYou>
								<FromNightShift>
									<Bubble variant="muted">
										<BubbleContent>{one.reply}</BubbleContent>
									</Bubble>
								</FromNightShift>
							</>
						)}
					</div>
				))}
				{notes.loading ? (
					<Skeleton className="h-24 w-full" />
				) : notes.error && !current ? (
					<FromNightShift>
						<Bubble variant="muted">
							<BubbleContent>
								The learnings did not load: {notes.error.message}
							</BubbleContent>
						</Bubble>
					</FromNightShift>
				) : current ? (
					<Question
						key={noteKey(current)}
						note={current}
						position={notes.checked + 1}
						total={notes.total}
						runId={notes.runOf(current)}
						onAnswer={(decision, answer) => onAnswer(current, decision, answer)}
						onChange={() => onChange(current)}
						onLater={() => notes.putOff(current)}
					/>
				) : (
					<FromNightShift>
						<Bubble variant="muted">
							<BubbleContent>
								{notes.total === 0
									? "Nothing to check. When an agent learns something, you check it here."
									: "That is all for now. Agents read what you kept from their next run."}
							</BubbleContent>
						</Bubble>
					</FromNightShift>
				)}
			</MessageGroup>
		</PageSection>
	);
}

function Question({
	note,
	position,
	total,
	runId,
	onAnswer,
	onChange,
	onLater,
}: {
	note: NoteToCheck;
	position: number;
	total: number;
	runId: string | null;
	onAnswer: (decision: "keep" | "delete", answer: string) => void;
	onChange: () => void;
	onLater: () => void;
}) {
	const kept = note.nearTo.find((near) => near.kept);
	const waits = note.nearTo.find((near) => !near.kept);
	const later = (
		<Button size="sm" variant="ghost" onClick={onLater}>
			<SkipForwardIcon data-icon="inline-start" />
			Later
		</Button>
	);
	return (
		<FromNightShift>
			<p className="text-xs text-muted-foreground tabular-nums">
				{position} of {total} · {formatRelative(note.proposedAt)}
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
			</p>
			<Bubble variant="muted" className="max-w-full">
				<BubbleContent className="text-base">{note.note}</BubbleContent>
			</Bubble>
			{kept ? (
				<Bubble variant="outline" className="max-w-full">
					<BubbleContent>
						<span className="block text-xs text-muted-foreground">
							You kept this before
						</span>
						{kept.note}
					</BubbleContent>
				</Bubble>
			) : waits ? (
				<p className="text-sm text-muted-foreground">
					Close to a note that also waits: “{waits.note}”
				</p>
			) : null}
			{!note.mayDecide ? (
				<div className="flex flex-wrap items-center gap-2">
					<p className="text-sm text-muted-foreground">{ASK_A_MEMBER}</p>
					{later}
				</div>
			) : kept ? (
				<>
					<p className="text-sm">These are close. Which is right?</p>
					<div className="flex flex-wrap gap-2">
						<Button
							size="sm"
							onClick={() => onAnswer("keep", "Both are right.")}
						>
							Both are right
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={() => onAnswer("delete", "Only the one I kept.")}
						>
							Only the kept one
						</Button>
						<Button size="sm" variant="outline" onClick={onChange}>
							<PencilIcon data-icon="inline-start" />
							Change it
						</Button>
						{later}
					</div>
				</>
			) : (
				<>
					<p className="text-sm">Is this true?</p>
					<div className="flex flex-wrap gap-2">
						<Button size="sm" onClick={() => onAnswer("keep", "True.")}>
							<CheckIcon data-icon="inline-start" />
							True
						</Button>
						<Button size="sm" variant="outline" onClick={onChange}>
							<PencilIcon data-icon="inline-start" />
							Change it
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={() => onAnswer("delete", "Not true.")}
						>
							<XIcon data-icon="inline-start" />
							Not true
						</Button>
						{later}
					</div>
				</>
			)}
		</FromNightShift>
	);
}
