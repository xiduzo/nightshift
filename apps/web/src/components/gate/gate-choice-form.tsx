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
import { Textarea } from "@nightshift/ui/components/textarea";
import { cn } from "@nightshift/ui/lib/utils";
import { useId, useState } from "react";

import { outcomeLabel, outcomeStyle } from "@/components/outcome-badge";
import { useResolveGate } from "@/hooks/use-resolve-gate";
import type { OpenGate } from "@/lib/api-types";

/**
 * Answers an open Gate in two steps: pick a choice from the cards, add a
 * note if you want, then send. Nothing goes out before the send.
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
	const resolve = useResolveGate({ runTitle: gate.runTitle });

	const send = () => {
		if (!choice || resolve.isPending) return;
		const trimmed = note.trim();
		resolve.mutate({
			runId: gate.runId,
			stepId: gate.stepId,
			choice,
			note: trimmed === "" ? undefined : trimmed,
		});
	};

	return (
		<div className="flex flex-col gap-4">
			<RadioGroup
				value={choice}
				onValueChange={(next) => setChoice(next as string)}
				aria-labelledby={labelledBy}
				disabled={resolve.isPending}
				className="grid gap-2"
			>
				{gate.choices.map((option) => {
					const style = outcomeStyle(option.name);
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
				<Textarea
					id={`${id}-note`}
					value={note}
					onChange={(event) => setNote(event.target.value)}
					placeholder="Context for the next steps…"
					className="max-h-48 text-sm md:text-sm"
					rows={2}
					aria-describedby={`${id}-note-hint`}
					disabled={resolve.isPending}
				/>
				<FieldDescription id={`${id}-note-hint`} className="text-xs">
					The next steps of the run get your note, as{" "}
					<code className="font-mono">{`{{${gate.nodeId}.note}}`}</code>.
				</FieldDescription>
			</Field>
			<Button disabled={!choice || resolve.isPending} onClick={send}>
				{resolve.isPending ? <Spinner data-icon="inline-start" /> : null}
				{choice ? `Answer ${outcomeLabel(choice)}` : "Pick an answer"}
			</Button>
		</div>
	);
}
