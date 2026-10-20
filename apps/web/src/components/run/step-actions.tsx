import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Switch } from "@nightshift/ui/components/switch";
import { Textarea } from "@nightshift/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	CircleAlertIcon,
	EllipsisVerticalIcon,
	RotateCcwIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { StepSummary } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";

/** An Agent step whose conversation can go on: its harness named a session. */
function continuesSession(step: StepSummary): boolean {
	return (
		step.nodeType === "agent" &&
		step.sessions.some((session) => session.harnessSessionId !== null)
	);
}

/** The optional message an agent gets when it goes on. */
function FollowUpField({
	value,
	onChange,
	disabled,
}: {
	value: string;
	onChange: (value: string) => void;
	disabled: boolean;
}) {
	const id = useId();
	return (
		<Field>
			<FieldLabel htmlFor={id}>Follow-up prompt (optional)</FieldLabel>
			<Textarea
				id={id}
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
				placeholder="Tell the agent what to do next…"
				className="max-h-40 min-h-16 text-sm"
				rows={3}
			/>
			<FieldDescription>
				If you leave it empty, the agent gets "Continue where you left off."
			</FieldDescription>
		</Field>
	);
}

function ErrorAlert({ title, error }: { title: string; error: Error | null }) {
	if (!error) return null;
	return (
		<Alert variant="destructive">
			<CircleAlertIcon />
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{error.message}</AlertDescription>
		</Alert>
	);
}

/**
 * Stops the running step and starts it again at once, for a step that
 * looks stuck. An agent goes on with its conversation and an optional
 * follow-up prompt.
 */
export function RestartStepDialog({
	runId,
	step,
	open,
	onOpenChange,
}: {
	runId: string;
	/** The step that runs now. */
	step: StepSummary;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const [prompt, setPrompt] = useState("");
	const agent = continuesSession(step);
	const restart = useMutation(
		orpc.runs.restartStep.mutationOptions({
			onSuccess: () => {
				setPrompt("");
				onOpenChange(false);
				toast.success(`Restarted ${step.nodeId}.`);
				void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
			},
		}),
	);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) restart.reset();
				onOpenChange(next);
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<form
					className="contents"
					onSubmit={(event) => {
						event.preventDefault();
						if (restart.isPending) return;
						restart.mutate({
							runId,
							stepId: step.id,
							prompt: (agent && prompt.trim()) || undefined,
						});
					}}
				>
					<DialogHeader>
						<DialogTitle>
							Restart <span className="font-mono">{step.nodeId}</span>?
						</DialogTitle>
						<DialogDescription>
							Night Shift stops this step and starts it again at once.{" "}
							{agent
								? "The agent continues where it left off."
								: "The step runs again from the start."}
						</DialogDescription>
					</DialogHeader>
					{agent ? (
						<FollowUpField
							value={prompt}
							onChange={setPrompt}
							disabled={restart.isPending}
						/>
					) : null}
					<ErrorAlert title="The step did not restart" error={restart.error} />
					<DialogFooter>
						<DialogClose render={<Button variant="outline" type="button" />}>
							Cancel
						</DialogClose>
						<Button type="submit" disabled={restart.isPending}>
							{restart.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<RotateCcwIcon data-icon="inline-start" />
							)}
							{restart.isPending ? "Restarting…" : "Restart step"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/**
 * The actions of one step row in a run that is not going: run the flow
 * again from this step. A step inside a called flow cannot be the start.
 */
export function StepRowMenu({
	runId,
	step,
}: {
	runId: string;
	step: StepSummary;
}) {
	const [rerunning, setRerunning] = useState(false);
	const nested = step.scope !== null;
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-xs"
							className="text-muted-foreground"
							aria-label={`Actions for ${step.nodeId}`}
						/>
					}
				>
					<EllipsisVerticalIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-64">
					<DropdownMenuItem
						disabled={nested}
						onClick={() => setRerunning(true)}
					>
						<RotateCcwIcon />
						<span className="flex flex-col">
							Run again from here
							<span className="text-muted-foreground text-xs">
								{nested
									? "Run the step that calls this flow again instead."
									: "Runs this step again, then the steps after it."}
							</span>
						</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{nested ? null : (
				<RerunDialog
					runId={runId}
					step={step}
					open={rerunning}
					onOpenChange={setRerunning}
				/>
			)}
		</>
	);
}

/** Runs the flow again from one step, with an optional follow-up for an agent. */
function RerunDialog({
	runId,
	step,
	open,
	onOpenChange,
}: {
	runId: string;
	step: StepSummary;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [prompt, setPrompt] = useState("");
	const [fresh, setFresh] = useState(false);
	const agent = continuesSession(step);
	const rerun = useMutation(
		orpc.runs.rerun.mutationOptions({
			onSuccess: () => {
				setPrompt("");
				setFresh(false);
				onOpenChange(false);
				toast.success(`Running again from ${step.nodeId}.`);
				void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
			},
		}),
	);
	const continues = agent && !fresh;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) rerun.reset();
				onOpenChange(next);
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<form
					className="contents"
					onSubmit={(event) => {
						event.preventDefault();
						if (rerun.isPending) return;
						rerun.mutate({
							runId,
							nodeId: step.nodeId,
							stepId: step.id,
							prompt: (continues && prompt.trim()) || undefined,
							fresh: agent && fresh ? true : undefined,
						});
					}}
				>
					<DialogHeader>
						<DialogTitle>
							Run again from <span className="font-mono">{step.nodeId}</span>?
						</DialogTitle>
						<DialogDescription>
							Night Shift runs this step again. The steps after it follow as the
							flow says.
						</DialogDescription>
					</DialogHeader>
					{agent ? (
						<FieldGroup>
							<Field orientation="horizontal" className="items-start">
								<Switch
									id={`${id}-fresh`}
									checked={fresh}
									disabled={rerun.isPending}
									className="mt-0.5"
									onCheckedChange={(on) => setFresh(on === true)}
								/>
								<FieldContent>
									<FieldLabel htmlFor={`${id}-fresh`}>Start fresh</FieldLabel>
									<FieldDescription>
										{fresh
											? "The agent starts a new conversation with the prompt from the flow."
											: "The agent continues its conversation from this step."}
									</FieldDescription>
								</FieldContent>
							</Field>
							{continues ? (
								<FollowUpField
									value={prompt}
									onChange={setPrompt}
									disabled={rerun.isPending}
								/>
							) : null}
						</FieldGroup>
					) : null}
					<ErrorAlert title="The run did not start again" error={rerun.error} />
					<DialogFooter>
						<DialogClose render={<Button variant="outline" type="button" />}>
							Cancel
						</DialogClose>
						<Button type="submit" disabled={rerun.isPending}>
							{rerun.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<RotateCcwIcon data-icon="inline-start" />
							)}
							{rerun.isPending ? "Starting…" : "Run again"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
