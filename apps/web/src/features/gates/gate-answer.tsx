import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import { useId, useState } from "react";
import { outcomeLabel, outcomeStyle } from "@/features/flows";
import type { GateChoice } from "@/shared/api";
import { LargerTextarea } from "@/shared/larger-window";
import { useResolveGate } from "./use-resolve-gate";

/**
 * Answers an open Gate: an optional note, then one button per choice. A click
 * on a choice sends it, and the run walks on along that choice's edge.
 */
export function GateAnswer({
	runId,
	stepId,
	nodeId,
	choices,
	runTitle,
	walkerName,
	className,
}: {
	runId: string;
	stepId: string;
	nodeId: string;
	choices: GateChoice[];
	/** Named in the confirmation toast. */
	runTitle?: string;
	/** The device that runs the run, when it is not this computer: the answer goes to it. */
	walkerName?: string;
	className?: string;
}) {
	const id = useId();
	const [note, setNote] = useState("");
	const resolve = useResolveGate({
		...(runTitle ? { runTitle } : {}),
		...(walkerName ? { walkerName } : {}),
	});

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

	return (
		<div className={cn("flex flex-col gap-5", className)}>
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
					className="max-h-40 min-h-10 text-sm md:text-sm"
					rows={2}
					aria-describedby={`${id}-note-hint`}
					disabled={resolve.isPending}
				/>
				<FieldDescription id={`${id}-note-hint`} className="text-xs">
					The next steps of the run get your note, as{" "}
					<code className="font-mono">{`{{${nodeId}.note}}`}</code>.
				</FieldDescription>
			</Field>
			<FieldSet className="gap-0">
				<FieldLegend variant="label" className="mb-2">
					Your answer
				</FieldLegend>
				<div className="grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
					{choices.map((choice) => {
						const style = outcomeStyle(choice.name, choice.color);
						const Icon = style.icon;
						const sending =
							resolve.isPending && resolve.variables?.choice === choice.name;
						return (
							<Button
								key={choice.name}
								type="button"
								variant="outline"
								disabled={resolve.isPending}
								aria-busy={sending || undefined}
								onClick={() => answer(choice.name)}
								aria-describedby={
									choice.description ? `${id}-${choice.name}` : undefined
								}
								className="h-auto min-h-11 flex-col items-start justify-center gap-0.5 whitespace-normal px-3 py-2 text-left"
							>
								<span className="flex items-center gap-1.5 font-medium font-mono text-sm">
									{sending ? (
										<Spinner className="size-3.5" aria-hidden="true" />
									) : (
										<Icon
											className={cn("size-3.5", style.text)}
											aria-hidden="true"
										/>
									)}
									{outcomeLabel(choice.name)}
								</span>
								{choice.description ? (
									<span
										id={`${id}-${choice.name}`}
										className="font-normal text-muted-foreground text-xs leading-snug"
									>
										{choice.description}
									</span>
								) : null}
							</Button>
						);
					})}
				</div>
			</FieldSet>
		</div>
	);
}
