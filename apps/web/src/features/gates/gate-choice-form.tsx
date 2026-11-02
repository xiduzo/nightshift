import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
	FieldTitle,
} from "@nightshift/ui/components/field";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui/components/radio-group";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import { useId, useState } from "react";
import { outcomeLabel, outcomeStyle } from "@/features/flows";
import type { OpenGate } from "@/shared/api";
import { LargerTextarea } from "@/shared/larger-window";
import { AnswerFilesField, useAnswerFiles } from "./answer-files";
import { GateDeadline } from "./gate-deadline";
import { useResolveGate } from "./use-resolve-gate";

/**
 * Answers an open Gate in two steps: pick a choice from the cards, add a
 * note and files if you want, then send. Nothing goes out before the send.
 */
export function GateChoiceForm({
	gate,
	labelledBy,
}: {
	gate: OpenGate;
	/** The heading that names the choices. */
	labelledBy: string;
}) {
	const id = useId();
	const [choice, setChoice] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const files = useAnswerFiles();
	const [reading, setReading] = useState(false);
	const resolve = useResolveGate({ runTitle: gate.runTitle });
	const busy = resolve.isPending || reading;

	const send = async () => {
		if (!choice || busy || files.problem) return;
		const trimmed = note.trim();
		setReading(true);
		const attached = await files.read().finally(() => setReading(false));
		resolve.mutate({
			runId: gate.runId,
			stepId: gate.stepId,
			choice,
			note: trimmed === "" ? undefined : trimmed,
			...(attached ? { files: attached } : {}),
		});
	};

	return (
		<div className="flex flex-col gap-4">
			<GateDeadline deadline={gate.deadline} />
			<RadioGroup
				value={choice}
				onValueChange={(next) => setChoice(next as string)}
				aria-labelledby={labelledBy}
				disabled={busy}
				className="grid gap-2"
			>
				{gate.choices.map((option) => {
					const style = outcomeStyle(option.name, option.color);
					const Icon = style.icon;
					return (
						<FieldLabel key={option.name} htmlFor={`${id}-${option.name}`}>
							<Field orientation="horizontal">
								<FieldContent>
									<FieldTitle className="font-mono">
										<Icon
											className={cn("size-3.5", style.text)}
											aria-hidden="true"
										/>
										{outcomeLabel(option.name)}
									</FieldTitle>
									{option.description ? (
										<FieldDescription className="text-xs">
											{option.description}
										</FieldDescription>
									) : null}
								</FieldContent>
								<RadioGroupItem
									value={option.name}
									id={`${id}-${option.name}`}
								/>
							</Field>
						</FieldLabel>
					);
				})}
			</RadioGroup>
			<Field className="gap-2">
				<FieldLabel htmlFor={`${id}-note`}>
					Note
					<span className="font-normal text-muted-foreground">(optional)</span>
				</FieldLabel>
				<LargerTextarea
					title="Note"
					id={`${id}-note`}
					value={note}
					onChange={(event) => setNote(event.target.value)}
					placeholder="Context for the next steps…"
					className="max-h-48 text-sm md:text-sm"
					rows={2}
					aria-describedby={`${id}-note-hint`}
					disabled={busy}
				/>
				<FieldDescription id={`${id}-note-hint`} className="text-xs">
					The next steps of the run get your note, as{" "}
					<code className="font-mono">{`{{${gate.nodeId}.note}}`}</code>.
				</FieldDescription>
			</Field>
			<AnswerFilesField files={files} disabled={busy} />
			<Button
				disabled={!choice || busy || files.problem !== null}
				onClick={send}
			>
				{busy ? <Spinner data-icon="inline-start" /> : null}
				{choice ? `Answer ${outcomeLabel(choice)}` : "Pick an answer"}
			</Button>
		</div>
	);
}
