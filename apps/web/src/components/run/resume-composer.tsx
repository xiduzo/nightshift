import { Button } from "@nightshift/ui/components/button";
import { Textarea } from "@nightshift/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlayIcon } from "lucide-react";
import { useId, useState } from "react";

import type { StepSummary } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";

/** Continues a stopped, failed or interrupted run at its last step's node. */
export function ResumeComposer({
	runId,
	lastStep,
}: {
	runId: string;
	lastStep: StepSummary | undefined;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [prompt, setPrompt] = useState("");

	const resumeRun = useMutation(
		orpc.runs.resume.mutationOptions({
			onSuccess: () => {
				setPrompt("");
				void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
			},
		}),
	);

	const submit = () => {
		if (resumeRun.isPending) return;
		resumeRun.mutate({ runId, prompt: prompt.trim() || undefined });
	};

	const where = lastStep
		? lastStep.nodeType === "agent"
			? `Resuming continues at ${lastStep.nodeId}: the agent picks up its last session in the same worktree.`
			: lastStep.nodeType === "gate"
				? `Resuming opens the gate ${lastStep.nodeId} again and waits for your answer.`
				: `Resuming runs ${lastStep.nodeId} again in the same worktree.`
		: "Resuming continues the run in the same worktree.";

	return (
		<form
			className="border-t bg-background px-4 py-3"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<div className="mx-auto flex max-w-4xl flex-col gap-2">
				<label
					htmlFor={`${id}-prompt`}
					className="text-muted-foreground text-xs"
				>
					Follow-up prompt (optional). {where}
				</label>
				<div className="flex items-end gap-2">
					<Textarea
						id={`${id}-prompt`}
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								submit();
							}
						}}
						placeholder="Tell the agent what to do next…"
						className="max-h-40 min-h-9 text-sm md:text-sm"
						rows={1}
					/>
					<Button type="submit" disabled={resumeRun.isPending}>
						<PlayIcon data-icon="inline-start" />
						{resumeRun.isPending ? "Resuming…" : "Resume"}
					</Button>
				</div>
				{resumeRun.error ? (
					<p role="alert" className="text-destructive text-xs">
						{resumeRun.error.message}
					</p>
				) : null}
			</div>
		</form>
	);
}
