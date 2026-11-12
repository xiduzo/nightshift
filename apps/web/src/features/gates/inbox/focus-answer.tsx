import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Kbd } from "@nightshift/ui/components/kbd";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import {
	CheckIcon,
	CornerDownLeftIcon,
	LoaderIcon,
	LockIcon,
} from "lucide-react";
import { type CSSProperties, useEffect, useId, useState } from "react";
import { outcomeLabel, outcomeStyle } from "@/features/flows";
import type { OpenGate } from "@/shared/api";
import { LargerTextarea } from "@/shared/larger-window";
import { AnswerFilesField, useAnswerFiles } from "../answer-files";
import { AskForm } from "../ask-form";
import { GateDeadline } from "../gate-deadline";
import { useResolveGate } from "../use-resolve-gate";
import { WrittenByModel } from "../written-by-model";

/** What you picked and wrote for one Gate. The inbox keeps it while you step to another Gate. */
export type AnswerDraft = { choice: string | null; note: string };

export const EMPTY_DRAFT: AnswerDraft = { choice: null, note: "" };

/** The choices of a Gate, the recommended one first: the order of the 1–9 keys. */
export function orderedChoices(gate: OpenGate): OpenGate["choices"] {
	const recommended = gate.brief.recommendation?.option ?? null;
	return [...gate.choices].sort(
		(a, b) => Number(b.name === recommended) - Number(a.name === recommended),
	);
}

/** A key press that belongs to a field, not to the inbox. */
export function typing(event: KeyboardEvent): boolean {
	const target = event.target as HTMLElement | null;
	return Boolean(
		target?.closest("input, textarea, select, [contenteditable='true']"),
	);
}

/**
 * Your answer to the Gate in focus. Each choice shows in its own colour,
 * with what it does. Pick one (click, or 1–9), add context if you want,
 * then send (the button, or Enter). Nothing goes out before the send. An
 * Ask shows its form. A Gate you may only read says so.
 */
export function FocusAnswer({
	gate,
	draft,
	onDraft,
}: {
	gate: OpenGate;
	draft: AnswerDraft;
	onDraft: (next: AnswerDraft) => void;
}) {
	const id = useId();
	const files = useAnswerFiles();
	const [reading, setReading] = useState(false);
	const resolve = useResolveGate({ runTitle: gate.runTitle });
	const busy = resolve.isPending || reading || gate.answerPending;
	const held = gate.branchesWork;
	const recommended = gate.brief.recommendation?.option ?? null;
	const choices = orderedChoices(gate);
	const chosen = gate.choices.find((c) => c.name === draft.choice) ?? null;
	const impactsByModel =
		gate.brief.byModel.includes("impacts") &&
		gate.choices.some((c) => c.impact);
	const canSend =
		chosen !== null &&
		gate.canAnswer &&
		!held &&
		!busy &&
		files.problem === null &&
		(!chosen.needsNote || draft.note.trim() !== "");

	const pick = (choice: string | null) => {
		onDraft({ ...draft, choice });
		// Straight on to the context: type, then Enter.
		if (choice) {
			requestAnimationFrame(() =>
				document.getElementById(`${id}-note`)?.focus(),
			);
		}
	};

	const send = async () => {
		if (!chosen || !canSend) return;
		const trimmed = draft.note.trim();
		setReading(true);
		const attached = await files.read().finally(() => setReading(false));
		resolve.mutate({
			runId: gate.runId,
			stepId: gate.stepId,
			choice: chosen.name,
			note: trimmed === "" ? undefined : trimmed,
			...(attached ? { files: attached } : {}),
		});
	};

	// 1–9 picks, Enter sends, Esc clears. Not while you type in a field.
	useEffect(() => {
		if (gate.form || !gate.canAnswer) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.altKey || event.metaKey || event.ctrlKey || typing(event))
				return;
			if (/^[1-9]$/.test(event.key)) {
				const choice = choices[Number(event.key) - 1];
				if (!choice) return;
				event.preventDefault();
				pick(choice.name);
			} else if (event.key === "Enter" && chosen) {
				event.preventDefault();
				void send();
			} else if (event.key === "Escape" && chosen) {
				pick(null);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	if (gate.canAnswer && gate.form) {
		return (
			<AnswerSection id={id}>
				<BusyNotice held={held} />
				<AskForm
					runId={gate.runId}
					stepId={gate.stepId}
					form={gate.form}
					deadline={gate.deadline}
					runTitle={gate.runTitle}
					filesHere={gate.walker.thisDevice}
					held={held}
				/>
			</AnswerSection>
		);
	}

	return (
		<AnswerSection id={id}>
			{gate.canAnswer ? null : (
				<Alert>
					<LockIcon />
					<AlertTitle>You can read this Gate only</AlertTitle>
					<AlertDescription>
						Your role in {gate.spaceName} does not let you answer Gates. Ask an
						owner or admin of the Space to answer it, or to give you another
						role.
					</AlertDescription>
				</Alert>
			)}
			<fieldset
				className="m-0 grid min-w-0 gap-2 border-0 p-0"
				aria-labelledby={`${id}-title`}
			>
				{choices.map((choice, index) => {
					const style = outcomeStyle(choice.name, choice.color);
					const Icon = style.icon;
					const selected = choice.name === draft.choice;
					const what = choice.impact ?? choice.description;
					return (
						<button
							key={choice.name}
							type="button"
							aria-pressed={selected}
							disabled={!gate.canAnswer || busy}
							onClick={() => pick(selected ? null : choice.name)}
							// The ring takes the choice's own colour.
							style={
								selected
									? ({ "--tw-ring-color": style.color } as CSSProperties)
									: undefined
							}
							className={cn(
								"flex items-start gap-3 rounded-xl border p-3 text-left outline-none transition-[background-color,opacity] focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
								selected ? cn(style.badge, "ring-2") : "hover:bg-muted/60",
								draft.choice && !selected && "opacity-60 hover:opacity-100",
							)}
						>
							{gate.canAnswer ? (
								<Kbd className="mt-0.5">{index + 1}</Kbd>
							) : null}
							<span className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="flex flex-wrap items-center gap-2 font-medium font-mono">
									<Icon className={cn("size-4", style.text)} aria-hidden />
									<span className="text-foreground">
										{outcomeLabel(choice.name)}
									</span>
									{choice.name === recommended ? (
										<Badge variant="secondary" className="font-sans">
											Recommended
										</Badge>
									) : null}
									{gate.deadline?.choose === choice.name ? (
										<Badge variant="outline" className="font-sans">
											Picked at the deadline
										</Badge>
									) : null}
								</span>
								{what ? (
									<span className="text-muted-foreground text-xs">{what}</span>
								) : null}
							</span>
							{selected ? (
								<CheckIcon
									className={cn("size-4 shrink-0", style.text)}
									aria-hidden
								/>
							) : null}
						</button>
					);
				})}
			</fieldset>
			{impactsByModel ? (
				<WrittenByModel>Night Shift wrote what each answer does</WrittenByModel>
			) : null}
			{chosen ? (
				<div className="flex flex-col gap-3 rounded-xl border p-3">
					<Field className="gap-1.5">
						<FieldLabel htmlFor={`${id}-note`}>
							{chosen.needsNote ? "Context" : "Add context"}
							<span className="font-normal text-muted-foreground">
								{chosen.needsNote ? "(needed for this answer)" : "(optional)"}
							</span>
						</FieldLabel>
						<NoteField
							id={`${id}-note`}
							value={draft.note}
							needsNote={chosen.needsNote === true}
							disabled={busy}
							onChange={(value) => onDraft({ ...draft, note: value })}
							onSend={() => void send()}
						/>
						<FieldDescription className="text-xs">
							The next steps get it as{" "}
							<code className="font-mono">{`{{${gate.nodeId}.note}}`}</code>.
							Enter sends. Shift+Enter starts a new line.
						</FieldDescription>
					</Field>
					<AnswerFilesField files={files} disabled={busy} />
					<BusyNotice held={held} />
					<div className="flex items-center justify-end gap-2">
						<Button variant="ghost" disabled={busy} onClick={() => pick(null)}>
							Clear
						</Button>
						<Button disabled={!canSend} onClick={() => void send()}>
							{busy ? <Spinner data-icon="inline-start" /> : null}
							Send {outcomeLabel(chosen.name)}
							{busy ? null : <CornerDownLeftIcon data-icon="inline-end" />}
						</Button>
					</div>
				</div>
			) : (
				<GateDeadline deadline={gate.deadline} />
			)}
		</AnswerSection>
	);
}

function AnswerSection({
	id,
	children,
}: {
	id: string;
	children: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-3" aria-labelledby={`${id}-title`}>
			<h2
				id={`${id}-title`}
				className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
			>
				Your answer
			</h2>
			{children}
		</section>
	);
}

/** Another branch of the run still works: you can pick and write, the send waits. */
function BusyNotice({ held }: { held: boolean }) {
	if (!held) return null;
	return (
		<Alert>
			<LoaderIcon />
			<AlertTitle>The run is still busy</AlertTitle>
			<AlertDescription>
				Another branch of this run still works. You can send your answer when
				its step ends.
			</AlertDescription>
		</Alert>
	);
}

function NoteField({
	id,
	value,
	needsNote,
	disabled,
	onChange,
	onSend,
}: {
	id: string;
	value: string;
	needsNote: boolean;
	disabled: boolean;
	onChange: (value: string) => void;
	onSend: () => void;
}) {
	return (
		<LargerTextarea
			title="Context"
			id={id}
			value={value}
			onChange={(event) => onChange(event.target.value)}
			onKeyDown={(event) => {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					onSend();
				} else if (event.key === "Escape") {
					event.currentTarget.blur();
				}
			}}
			placeholder={
				needsNote
					? "Tell the next steps what to do…"
					: "Anything the next steps should know…"
			}
			className="max-h-48 text-sm md:text-sm"
			rows={2}
			disabled={disabled}
		/>
	);
}
