import { parseGateQuestion } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import { Field, FieldLabel } from "@nightshift/ui/components/field";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemFooter,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import { HandIcon } from "lucide-react";
import { useId, useState } from "react";
import { outcomeLabel, outcomeStyle } from "@/features/flows";
import type { GateChoice, OpenGate } from "@/shared/api";
import { formatDateTime, formatRelative } from "@/shared/format";
import { LargerTextarea } from "@/shared/larger-window";
import { InlineMarkdown } from "@/shared/markdown";
import { GateDeadline } from "./gate-deadline";
import { ContextList } from "./gate-question";
import { useResolveGate } from "./use-resolve-gate";

/**
 * An open Gate where it opened, in a run's transcript: its question with
 * one button per choice, to answer it right there. A Gate with two choices
 * shows them beside the question. A Gate with more shows them as a list
 * under it. A note is optional, unless a choice needs one: the answer an
 * agent asked for.
 */
export function GateConfirmation({
	runId,
	stepId,
	question,
	choices,
	deadline = null,
	openedAt,
	walkerName,
}: {
	runId: string;
	stepId: string;
	question: string;
	choices: GateChoice[];
	/** What Night Shift picks when nobody answers in time. */
	deadline?: OpenGate["deadline"];
	openedAt: number;
	/** The device that runs the run, when it is not this computer: the answer goes to it. */
	walkerName?: string;
}) {
	const id = useId();
	const [note, setNote] = useState("");
	const resolve = useResolveGate(walkerName ? { walkerName } : {});
	const { headline, context } = parseGateQuestion(question);
	// An agent that asks goes on with the note: its answer needs one.
	const answersAgent = choices.some((choice) => choice.needsNote);
	const beside = choices.length <= 2;
	const empty = note.trim() === "";

	const answer = (choice: string) => {
		if (resolve.isPending) return;
		const trimmed = note.trim();
		resolve.mutate(
			{ runId, stepId, choice, note: trimmed === "" ? undefined : trimmed },
			{
				onSuccess: (result) => {
					if (result.kind === "answered") setNote("");
				},
			},
		);
	};

	const buttons = choices.map((choice) => {
		const style = outcomeStyle(choice.name, choice.color);
		const Icon = style.icon;
		const sending =
			resolve.isPending && resolve.variables?.choice === choice.name;
		return (
			<Button
				key={choice.name}
				type="button"
				variant="outline"
				size="sm"
				disabled={resolve.isPending || (choice.needsNote && empty)}
				aria-busy={sending || undefined}
				title={choice.description}
				onClick={() => answer(choice.name)}
				className={cn(
					!beside &&
						"h-auto min-h-9 w-full flex-col items-start gap-0.5 whitespace-normal py-1.5 text-left",
				)}
			>
				<span className="flex items-center gap-1.5 font-mono">
					{sending ? (
						<Spinner className="size-3.5" aria-hidden="true" />
					) : (
						<Icon className={cn("size-3.5", style.text)} aria-hidden="true" />
					)}
					{outcomeLabel(choice.name)}
				</span>
				{!beside && choice.description ? (
					<span className="font-normal text-muted-foreground text-xs leading-snug">
						{choice.description}
					</span>
				) : null}
			</Button>
		);
	});

	return (
		<Item
			variant="outline"
			size="sm"
			role="group"
			className="border-status-waiting/50"
			aria-labelledby={`${id}-question`}
		>
			<ItemMedia variant="icon">
				<HandIcon className="text-status-waiting" />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle
					id={`${id}-question`}
					className="line-clamp-none w-auto whitespace-pre-wrap break-words"
				>
					<span>
						<InlineMarkdown text={headline} />
					</span>
				</ItemTitle>
				<ItemDescription className="text-xs">
					Waiting for you · opened{" "}
					<time
						dateTime={new Date(openedAt).toISOString()}
						title={formatDateTime(openedAt)}
					>
						{formatRelative(openedAt)}
					</time>
				</ItemDescription>
			</ItemContent>
			{beside ? <ItemActions>{buttons}</ItemActions> : null}
			<ItemFooter className="flex-col items-stretch gap-3">
				{context.length > 0 ? <ContextList items={context} /> : null}
				<Field className="gap-1.5">
					<FieldLabel htmlFor={`${id}-note`} className="text-xs">
						Note
						{answersAgent ? null : (
							<span className="font-normal text-muted-foreground">
								(optional)
							</span>
						)}
					</FieldLabel>
					<LargerTextarea
						title="Note"
						id={`${id}-note`}
						value={note}
						onChange={(event) => setNote(event.target.value)}
						placeholder={
							answersAgent
								? "Answer the agent's questions…"
								: "Context for the next steps…"
						}
						className="max-h-40 min-h-9 text-sm md:text-sm"
						rows={1}
						disabled={resolve.isPending}
					/>
				</Field>
				{beside ? null : (
					<div className="grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
						{buttons}
					</div>
				)}
				<GateDeadline deadline={deadline} />
			</ItemFooter>
		</Item>
	);
}
