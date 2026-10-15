import { Label } from "@nightshift/ui/components/label";
import { Textarea } from "@nightshift/ui/components/textarea";
import { cn } from "@nightshift/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
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
		<div className={cn("flex flex-col gap-3", className)}>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${id}-note`}>
					Note
					<span className="text-muted-foreground">(optional)</span>
				</Label>
				<Textarea
					id={`${id}-note`}
					value={note}
					onChange={(event) => setNote(event.target.value)}
					placeholder="Context for the next steps…"
					className="max-h-40 min-h-9 text-sm md:text-sm"
					rows={2}
					aria-describedby={`${id}-note-hint`}
					disabled={resolve.isPending}
				/>
				<p id={`${id}-note-hint`} className="text-muted-foreground text-xs">
					Later nodes read it as{" "}
					<code className="font-mono">{`{{${nodeId}.note}}`}</code>.
				</p>
			</div>
			<fieldset className="flex flex-col gap-1.5">
				<legend className="mb-1.5 text-xs">Your answer</legend>
				<ul className="grid gap-2 sm:grid-cols-2">
					{choices.map((choice) => {
						const style = outcomeStyle(choice.name);
						const sending =
							resolve.isPending && resolve.variables?.choice === choice.name;
						return (
							<li key={choice.name} className="contents">
								<button
									type="button"
									disabled={resolve.isPending}
									onClick={() => answer(choice.name)}
									aria-describedby={
										choice.description ? `${id}-${choice.name}` : undefined
									}
									className="group/choice flex min-h-11 flex-col items-start gap-0.5 border border-l-[3px] bg-card px-3 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring active:translate-y-px disabled:cursor-default disabled:opacity-60 motion-reduce:transition-none"
									style={{ borderLeftColor: style.color }}
								>
									<span
										className={cn(
											"flex items-center gap-1.5 font-medium font-mono text-sm",
											style.text,
										)}
									>
										{sending ? (
											<LoaderCircleIcon
												className="size-3.5 animate-spin motion-reduce:animate-none"
												aria-hidden="true"
											/>
										) : null}
										{outcomeLabel(choice.name)}
									</span>
									{choice.description ? (
										<span
											id={`${id}-${choice.name}`}
											className="text-muted-foreground text-xs"
										>
											{choice.description}
										</span>
									) : null}
								</button>
							</li>
						);
					})}
				</ul>
			</fieldset>
		</div>
	);
}
