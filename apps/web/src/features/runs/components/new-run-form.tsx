import {
	HARNESS_CATALOG,
	QUICK_RUN_HARNESS,
	singleAgentFlow,
} from "@nightshift/flows";
import { Alert, AlertDescription } from "@nightshift/ui/components/alert";
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
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Kbd, KbdGroup } from "@nightshift/ui/components/kbd";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Textarea } from "@nightshift/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlayIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import { EFFORTS, ModelCombobox, PERMISSION_MODES } from "@/features/agents";
import type { Effort, PermissionMode } from "@/shared/api";
import { runMutations, runQueries } from "../queries";

/**
 * A quick run: one Agent node with a prompt, no flow file, in a dialog. The
 * fields live here, outside the dialog's content, so a closed dialog keeps
 * what was typed.
 */
export function QuickRunDialog({
	projectId,
	open,
	onOpenChange,
}: {
	projectId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const id = useId();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [prompt, setPrompt] = useState("");
	const [model, setModel] = useState<string>(
		HARNESS_CATALOG[QUICK_RUN_HARNESS].defaultModel,
	);
	const [permissionMode, setPermissionMode] =
		useState<PermissionMode>("acceptEdits");
	const [effort, setEffort] = useState<Effort | "">("");
	const [baseRef, setBaseRef] = useState("");
	const [flowError, setFlowError] = useState<string | null>(null);

	const startRun = useMutation(
		runMutations.start({
			onSuccess: (run) => {
				void queryClient.invalidateQueries({ queryKey: runQueries.all() });
				void navigate({ to: "/runs/$runId", params: { runId: run.id } });
			},
		}),
	);

	const canSubmit =
		prompt.trim() !== "" && model.trim() !== "" && !startRun.isPending;

	const submit = () => {
		if (!canSubmit) return;
		let flow: ReturnType<typeof singleAgentFlow>;
		try {
			flow = singleAgentFlow({
				prompt: prompt.trim(),
				model: model.trim(),
				permissionMode,
				effort: effort || undefined,
			});
		} catch (error) {
			setFlowError(
				`Could not build the run: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}
		setFlowError(null);
		startRun.mutate({
			projectId,
			flow,
			baseRef: baseRef.trim() || undefined,
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
				<form
					className="contents"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<DialogHeader>
						<DialogTitle>Quick run</DialogTitle>
						<DialogDescription>
							One agent with a prompt, no flow needed. It works on a new branch
							in its own copy of the project.
						</DialogDescription>
					</DialogHeader>

					<FieldGroup className="gap-5">
						<Field>
							<FieldLabel htmlFor={`${id}-prompt`}>Prompt</FieldLabel>
							<Textarea
								id={`${id}-prompt`}
								value={prompt}
								onChange={(event) => setPrompt(event.target.value)}
								onKeyDown={(event) => {
									if (
										event.key === "Enter" &&
										(event.metaKey || event.ctrlKey)
									) {
										event.preventDefault();
										submit();
									}
								}}
								placeholder="What should the agent do?"
								className="min-h-28 text-sm md:text-sm"
								aria-describedby={`${id}-prompt-hint`}
								required
								autoFocus
							/>
							<FieldDescription id={`${id}-prompt-hint`}>
								<KbdGroup>
									<Kbd>⌘/Ctrl</Kbd>
									<Kbd>Enter</Kbd>
								</KbdGroup>{" "}
								to start.
							</FieldDescription>
						</Field>

						<div className="grid gap-5 sm:grid-cols-2">
							<Field>
								<FieldLabel htmlFor={`${id}-model`}>Model</FieldLabel>
								<ModelCombobox
									id={`${id}-model`}
									harness={QUICK_RUN_HARNESS}
									value={model}
									onChange={setModel}
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor={`${id}-effort`}>
									Effort{" "}
									<span className="font-normal text-muted-foreground">
										(optional)
									</span>
								</FieldLabel>
								<NativeSelect
									id={`${id}-effort`}
									value={effort}
									className="w-full"
									onChange={(event) =>
										setEffort(event.target.value as Effort | "")
									}
								>
									<NativeSelectOption value="">
										Model default
									</NativeSelectOption>
									{EFFORTS.map((value) => (
										<NativeSelectOption key={value} value={value}>
											{value}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</Field>
							<Field>
								<FieldLabel htmlFor={`${id}-permission`}>
									Permission mode
								</FieldLabel>
								<NativeSelect
									id={`${id}-permission`}
									value={permissionMode}
									className="w-full"
									onChange={(event) =>
										setPermissionMode(event.target.value as PermissionMode)
									}
									aria-describedby={
										permissionMode === "bypassPermissions"
											? `${id}-permission-warning`
											: undefined
									}
								>
									{PERMISSION_MODES.map(({ value, label }) => (
										<NativeSelectOption key={value} value={value}>
											{label}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</Field>
							<Field>
								<FieldLabel htmlFor={`${id}-base-ref`}>
									Start from{" "}
									<span className="font-normal text-muted-foreground">
										(optional)
									</span>
								</FieldLabel>
								<Input
									id={`${id}-base-ref`}
									value={baseRef}
									onChange={(event) => setBaseRef(event.target.value)}
									placeholder="The current branch"
									className="font-mono"
									autoComplete="off"
									spellCheck={false}
								/>
							</Field>
						</div>

						{permissionMode === "bypassPermissions" ? (
							<Alert
								id={`${id}-permission-warning`}
								className="border-status-interrupted/40 text-status-interrupted"
							>
								<TriangleAlertIcon aria-hidden="true" />
								<AlertDescription className="text-status-interrupted">
									The agent runs every tool, shell commands included, without
									asking. Use it only on a repository you trust.
								</AlertDescription>
							</Alert>
						) : null}

						{flowError || startRun.error ? (
							<FieldError>{flowError ?? startRun.error?.message}</FieldError>
						) : null}
					</FieldGroup>

					<DialogFooter>
						<DialogClose render={<Button variant="outline" type="button" />}>
							Cancel
						</DialogClose>
						<Button type="submit" disabled={!canSubmit}>
							{startRun.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<PlayIcon data-icon="inline-start" />
							)}
							{startRun.isPending ? "Starting…" : "Start run"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
