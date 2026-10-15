import { singleAgentFlow } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import { Label } from "@nightshift/ui/components/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Textarea } from "@nightshift/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import type { Effort, PermissionMode } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";

const MODELS = ["sonnet", "opus", "haiku"];

const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
	{ value: "acceptEdits", label: "Accept edits" },
	{ value: "default", label: "Ask for each tool" },
	{ value: "plan", label: "Plan only" },
	{ value: "bypassPermissions", label: "Bypass permissions" },
];

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function NewRunForm({ projectId }: { projectId: string }) {
	const id = useId();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [prompt, setPrompt] = useState("");
	const [model, setModel] = useState("sonnet");
	const [permissionMode, setPermissionMode] =
		useState<PermissionMode>("acceptEdits");
	const [effort, setEffort] = useState<Effort | "">("");
	const [baseRef, setBaseRef] = useState("");
	const [flowError, setFlowError] = useState<string | null>(null);

	const startRun = useMutation(
		orpc.runs.start.mutationOptions({
			onSuccess: (run) => {
				void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
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
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${id}-prompt`}>Prompt</Label>
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
					placeholder="What should the agent do?"
					className="min-h-28 text-sm md:text-sm"
					aria-describedby={`${id}-prompt-hint`}
					required
				/>
				<p id={`${id}-prompt-hint`} className="text-muted-foreground text-xs">
					⌘/Ctrl + Enter to start.
				</p>
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${id}-model`}>Model</Label>
					<Input
						id={`${id}-model`}
						list={`${id}-models`}
						value={model}
						onChange={(event) => setModel(event.target.value)}
						autoComplete="off"
						spellCheck={false}
						required
					/>
					<datalist id={`${id}-models`}>
						{MODELS.map((value) => (
							<option key={value} value={value} />
						))}
					</datalist>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${id}-effort`}>
						Effort <span className="text-muted-foreground">(optional)</span>
					</Label>
					<NativeSelect
						id={`${id}-effort`}
						value={effort}
						onChange={(event) => setEffort(event.target.value as Effort | "")}
					>
						<NativeSelectOption value="">Model default</NativeSelectOption>
						{EFFORTS.map((value) => (
							<NativeSelectOption key={value} value={value}>
								{value}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${id}-permission`}>Permission mode</Label>
					<NativeSelect
						id={`${id}-permission`}
						value={permissionMode}
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
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${id}-base-ref`}>
						Base ref <span className="text-muted-foreground">(optional)</span>
					</Label>
					<Input
						id={`${id}-base-ref`}
						value={baseRef}
						onChange={(event) => setBaseRef(event.target.value)}
						placeholder="Current HEAD"
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
					/>
				</div>
			</div>

			{permissionMode === "bypassPermissions" ? (
				<p
					id={`${id}-permission-warning`}
					className="flex items-start gap-1.5 text-status-interrupted text-xs"
				>
					<TriangleAlertIcon
						className="mt-px size-3.5 shrink-0"
						aria-hidden="true"
					/>
					The agent runs every tool, shell commands included, without asking.
					Use it only on a repository you trust.
				</p>
			) : null}

			{flowError || startRun.error ? (
				<p role="alert" className="text-destructive text-xs">
					{flowError ?? startRun.error?.message}
				</p>
			) : null}

			<div>
				<Button type="submit" disabled={!canSubmit}>
					{startRun.isPending ? "Starting…" : "Start run"}
				</Button>
			</div>
		</form>
	);
}
