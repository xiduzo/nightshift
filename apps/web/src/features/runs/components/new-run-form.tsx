import { useRunActed } from "@nightshift/client";
import {
	HARNESS_CATALOG,
	QUICK_RUN_HARNESS,
	singleAgentFlow,
} from "@nightshift/flows";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nightshift/ui/components/tabs";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareTextIcon, WorkflowIcon } from "lucide-react";
import { useState } from "react";
import { harnessInfo } from "@/features/agents";
import {
	type AgentChoice,
	PickFlowRunForm,
	requestAgent,
} from "@/features/flows";
import { useHasFolder } from "@/features/projects";
import type { PermissionMode } from "@/shared/api";
import { orpc } from "@/shared/api";
import { runMutations } from "../queries";
import { DEFAULT_PERMISSION, QuickRunPrompt } from "./quick-run-prompt";

type QuickRunMode = "flow" | "prompt";

/**
 * A quick run, in a dialog with two tabs: one of the project's flows, or
 * one Agent node with a prompt and no flow file. The fields live here,
 * outside the dialog's content, so a closed dialog keeps what was typed.
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
	const navigate = useNavigate();
	const runActed = useRunActed({ orpc });
	const [prompt, setPrompt] = useState("");
	// No profile at first: the quick run's harness and its default model.
	const [agent, setAgent] = useState<AgentChoice>({
		harness: QUICK_RUN_HARNESS,
		model: HARNESS_CATALOG[QUICK_RUN_HARNESS].defaultModel,
	});
	const [permissionMode, setPermissionMode] = useState<PermissionMode | null>(
		null,
	);
	const [baseRef, setBaseRef] = useState("");
	// A project without a folder has no branches: nothing to start from.
	const withFolder = useHasFolder(projectId);
	const [flowError, setFlowError] = useState<string | null>(null);
	const [mode, setMode] = useState<QuickRunMode>("flow");
	const [flowName, setFlowName] = useState<string | null>(null);

	const startRun = useMutation(
		runMutations.start({
			onSuccess: (run) => {
				runActed(run.id);
				void navigate({ to: "/runs/$runId", params: { runId: run.id } });
			},
		}),
	);

	const canSubmit = prompt.trim() !== "" && !startRun.isPending;

	const submit = () => {
		if (!canSubmit) return;
		let flow: ReturnType<typeof singleAgentFlow>;
		try {
			const chosen = requestAgent(
				agent,
				(harness) => harnessInfo(harness).defaultModel,
			);
			flow = singleAgentFlow({
				prompt: prompt.trim(),
				...chosen,
				// A profile brings its own mode unless the person picked one.
				permissionMode:
					permissionMode ??
					(chosen.profile === undefined ? DEFAULT_PERMISSION : undefined),
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
			baseRef: (withFolder && baseRef.trim()) || undefined,
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg md:max-w-3xl lg:max-w-5xl xl:max-w-6xl">
				<DialogHeader>
					<DialogTitle>Quick run</DialogTitle>
					<DialogDescription>
						{withFolder
							? "Run a flow, or give one agent a prompt. The run works on a new branch in its own copy of the project."
							: "Run a flow, or give one agent a prompt."}
					</DialogDescription>
				</DialogHeader>

				<Tabs
					value={mode}
					onValueChange={(value) => setMode(value as QuickRunMode)}
					className="gap-6"
				>
					<TabsList className="w-full">
						<TabsTrigger value="flow">
							<WorkflowIcon data-icon="inline-start" />
							Flow
						</TabsTrigger>
						<TabsTrigger value="prompt">
							<MessageSquareTextIcon data-icon="inline-start" />
							Prompt
						</TabsTrigger>
					</TabsList>
					<TabsContent value="flow" className="grid gap-6">
						<PickFlowRunForm
							projectId={projectId}
							flowName={flowName}
							onFlowNameChange={setFlowName}
							onStarted={() => onOpenChange(false)}
						/>
					</TabsContent>
					<TabsContent value="prompt">
						<QuickRunPrompt
							projectId={projectId}
							prompt={prompt}
							onPromptChange={setPrompt}
							agent={agent}
							onAgentChange={setAgent}
							permissionMode={permissionMode}
							onPermissionModeChange={setPermissionMode}
							baseRef={baseRef}
							onBaseRefChange={setBaseRef}
							withFolder={withFolder}
							starting={startRun.isPending}
							error={flowError ?? startRun.error?.message ?? null}
							onSubmit={submit}
						/>
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}
