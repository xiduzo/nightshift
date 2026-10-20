import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupText,
	InputGroupTextarea,
} from "@nightshift/ui/components/input-group";
import { Kbd } from "@nightshift/ui/components/kbd";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlayIcon } from "lucide-react";
import { useId, useState } from "react";

import type { StepSummary } from "@/shared/api";
import { runMutations, runQueries } from "../queries";

/** Continues a stopped, failed or interrupted run at its last step's node. */
export function ResumeComposer({
	runId,
	lastStep,
	className,
}: {
	runId: string;
	lastStep: StepSummary | undefined;
	className?: string;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [prompt, setPrompt] = useState("");

	const resumeRun = useMutation(
		runMutations.resume({
			onSuccess: () => {
				setPrompt("");
				void queryClient.invalidateQueries({ queryKey: runQueries.all() });
			},
		}),
	);

	const submit = () => {
		if (resumeRun.isPending) return;
		resumeRun.mutate({ runId, prompt: prompt.trim() || undefined });
	};

	const where = lastStep?.scope
		? lastStep.scope.itemId === null
			? `Resuming continues at ${lastStep.nodeId}, inside the called flow.`
			: `Resuming continues at ${lastStep.nodeId}, inside the called flow, with the same item.`
		: lastStep
			? lastStep.nodeType === "agent"
				? `Resuming continues at ${lastStep.nodeId}: the agent picks up where it left off.`
				: lastStep.gate !== null
					? `Resuming opens the gate ${lastStep.nodeId} again and waits for your answer.`
					: `Resuming runs ${lastStep.nodeId} again.`
			: "Resuming continues the run where it left off.";

	return (
		<form
			className={cn("flex shrink-0 flex-col gap-2", className)}
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<label
				htmlFor={`${id}-prompt`}
				className="text-muted-foreground text-xs leading-relaxed"
			>
				<span className="font-medium text-foreground">
					Follow-up prompt (optional).
				</span>{" "}
				{where}
			</label>
			<InputGroup className="bg-background">
				<InputGroupTextarea
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
					className="max-h-40 min-h-12 text-sm md:text-sm"
					rows={2}
				/>
				<InputGroupAddon align="block-end">
					<InputGroupText className="hidden text-xs sm:flex">
						<Kbd>⌘</Kbd>
						<Kbd>Enter</Kbd>
					</InputGroupText>
					<InputGroupButton
						type="submit"
						variant="default"
						size="sm"
						className="ml-auto"
						disabled={resumeRun.isPending}
					>
						{resumeRun.isPending ? (
							<Spinner data-icon="inline-start" />
						) : (
							<PlayIcon data-icon="inline-start" />
						)}
						{resumeRun.isPending ? "Resuming…" : "Resume"}
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
			{resumeRun.error ? (
				<p role="alert" className="text-destructive text-xs">
					{resumeRun.error.message}
				</p>
			) : null}
		</form>
	);
}
