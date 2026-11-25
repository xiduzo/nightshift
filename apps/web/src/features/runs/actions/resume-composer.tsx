import { useRunActed } from "@nightshift/client";
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
import { useMutation } from "@tanstack/react-query";
import { PlayIcon } from "lucide-react";
import { useId, useState } from "react";

import type { StepSummary } from "@/shared/api";
import { orpc } from "@/shared/api";
import { runMutations } from "../queries";

/**
 * Continues a stopped, failed or interrupted run. A prompt goes to the
 * session of `sessionStep`. When no session waits, there is nothing to type,
 * and a text that is there already stays for the person to copy.
 */
export function ResumeComposer({
	runId,
	lastStep,
	sessionStep,
	className,
}: {
	runId: string;
	lastStep: StepSummary | undefined;
	/** The Agent step whose session gets the prompt. Unset: no session waits. */
	sessionStep: StepSummary | undefined;
	className?: string;
}) {
	const id = useId();
	const runActed = useRunActed({ orpc });
	const [prompt, setPrompt] = useState("");

	const resumeRun = useMutation(
		runMutations.resume({
			onSuccess: () => {
				setPrompt("");
				runActed(runId);
			},
		}),
	);

	const submit = () => {
		if (resumeRun.isPending) return;
		resumeRun.mutate({
			runId,
			prompt: prompt.trim() || undefined,
		});
	};

	const where = sessionStep
		? sessionStep.scope
			? sessionStep.scope.itemId === null
				? `The run continues at ${sessionStep.nodeId}, inside the called flow.`
				: `The run continues at ${sessionStep.nodeId}, inside the called flow, with the same item.`
			: `The agent at ${sessionStep.nodeId} continues where it stopped.`
		: lastStep?.gate && lastStep.outcome === "stopped"
			? `The gate ${lastStep.nodeId} opens again and waits for your answer.`
			: "The run continues where it stopped.";

	const button = (
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
	);

	return (
		<form
			className={cn("flex shrink-0 flex-col gap-2", className)}
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			{sessionStep || prompt !== "" ? (
				<>
					<label
						htmlFor={`${id}-prompt`}
						className="text-xs leading-relaxed text-muted-foreground"
					>
						<span className="font-medium text-foreground">
							{sessionStep
								? "Follow-up prompt (optional)."
								: "No agent waits for a prompt now."}
						</span>{" "}
						{sessionStep
							? where
							: "Copy your text if you need it. Remove it to continue the run."}
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
							{button}
						</InputGroupAddon>
					</InputGroup>
				</>
			) : (
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					{where}
					{button}
				</div>
			)}
			{resumeRun.error ? (
				<p role="alert" className="text-xs text-destructive">
					{resumeRun.error.message}
				</p>
			) : null}
		</form>
	);
}
