import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Textarea } from "@nightshift/ui/components/textarea";
import { cn } from "@nightshift/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import { outcomeLabel, outcomeStyle } from "@/components/outcome-badge";
import type { GateChoice } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";

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
	className,
}: {
	runId: string;
	stepId: string;
	nodeId: string;
	choices: GateChoice[];
	/** Named in the confirmation toast. */
	runTitle?: string;
	className?: string;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [note, setNote] = useState("");

	const resolve = useMutation(
		orpc.gates.resolve.mutationOptions({
			onSuccess: (_, input) => {
				toast.success(
					`Answered ${outcomeLabel(input.choice)}${runTitle ? ` · ${runTitle}` : ""}`,
					{ description: "The run goes on." },
				);
				setNote("");
				// Out of the inbox at once; the refetch confirms it.
				queryClient.setQueryData(orpc.gates.list.queryKey(), (gates) =>
					gates?.filter((gate) => gate.stepId !== input.stepId),
				);
				void queryClient.invalidateQueries({ queryKey: orpc.gates.key() });
				void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
			},
			onError: (error) => toast.error(`Could not answer: ${error.message}`),
		}),
	);

	const answer = (choice: string) => {
		if (resolve.isPending) return;
		const trimmed = note.trim();
		resolve.mutate({
			runId,
			stepId,
			choice,
			note: trimmed === "" ? undefined : trimmed,
		});
	};

	return (
		<div className={cn("flex flex-col gap-5", className)}>
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
					className="max-h-40 min-h-10 text-sm md:text-sm"
					rows={2}
					aria-describedby={`${id}-note-hint`}
					disabled={resolve.isPending}
				/>
				<FieldDescription id={`${id}-note-hint`} className="text-xs">
					Later nodes read it as{" "}
					<code className="font-mono">{`{{${nodeId}.note}}`}</code>.
				</FieldDescription>
			</Field>
			<FieldSet className="gap-0">
				<FieldLegend variant="label" className="mb-2">
					Your answer
				</FieldLegend>
				<div className="grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
					{choices.map((choice) => {
						const style = outcomeStyle(choice.name);
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
