import type { Flow, FlowIssue, FlowNode } from "@nightshift/flows";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import {
	ChevronRightIcon,
	CircleAlertIcon,
	CircleDotIcon,
	PlayIcon,
	SaveIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { OpenFlowContext } from "@/components/flow/open-flow-context";
import { outcomeLabel } from "@/components/outcome-badge";
import { StartRunDialog } from "@/components/run/start-run-dialog";
import { useProjectFlows } from "@/hooks/use-project-flows";
import {
	callersOf,
	checkFlow,
	isSavable,
	type NodeOption,
	newElementFlow,
	newFlow,
	optionNoun,
	removeEdge,
	removeNode,
	removeOutcome,
	renameNode,
	renameOutcome,
	restoreAgentOutcomes,
	restoreOutcome,
	setAgentOutcomes,
	updateEdge,
	updateNode,
} from "@/lib/flow-draft";
import { orpc } from "@/utils/orpc";

import { EdgeInspector } from "./edge-inspector";
import { EditorCanvas, type Selection } from "./editor-canvas";
import { FlowInspector } from "./flow-inspector";
import { IssuesPanel } from "./issues-panel";
import { NodeInspector } from "./node-inspector";
import { ProjectFlowsContext } from "./project-flows-context";

type Props = {
	projectId: string;
	projectName: string | undefined;
	name: string;
	initialFlow: Flow;
	/** False when the editor starts from a draft that is not on disk yet. */
	initiallySaved: boolean;
};

export function FlowEditor(props: Props) {
	return (
		<ReactFlowProvider>
			<Editor {...props} />
		</ReactFlowProvider>
	);
}

function Editor({
	projectId,
	projectName,
	name,
	initialFlow,
	initiallySaved,
}: Props) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { fitView } = useReactFlow();

	const [draft, setDraft] = useState<Flow>(initialFlow);
	const [savedJson, setSavedJson] = useState(() =>
		initiallySaved ? JSON.stringify(initialFlow) : "",
	);
	const [selection, setSelection] = useState<Selection>(null);

	const dirty = useMemo(
		() => JSON.stringify(draft) !== savedJson,
		[draft, savedJson],
	);
	// The other flow files, for Subflow and For Each calls. The draft stands in for this one.
	const projectFlows = useProjectFlows(projectId, name);
	const check = useMemo(
		() => checkFlow(draft, projectFlows.flows, name),
		[draft, projectFlows.flows, name],
	);
	const [starting, setStarting] = useState(false);
	const savable = useMemo(() => isSavable(draft), [draft]);
	const errorCount = check.issues.filter(
		(issue) => issue.severity === "error",
	).length;

	const changeFlow = useCallback(
		(change: (flow: Flow) => Flow) => setDraft(change),
		[],
	);

	const saveFlow = useMutation(
		orpc.flows.save.mutationOptions({
			onError: (error) => toast.error(`Could not save: ${error.message}`),
		}),
	);

	const canSave = dirty && savable && !saveFlow.isPending;

	/** After a save: the draft is the file now, and the cached flow follows. */
	const onSaved = useCallback(
		(snapshot: Flow, issues: FlowIssue[]) => {
			setSavedJson(JSON.stringify(snapshot));
			queryClient.setQueryData(
				orpc.flows.get.queryKey({ input: { projectId, name } }),
				(loaded) => (loaded ? { ...loaded, flow: snapshot, issues } : loaded),
			);
			void queryClient.invalidateQueries({
				queryKey: orpc.flows.list.key(),
			});
		},
		[queryClient, projectId, name],
	);

	const save = useCallback(() => {
		if (!canSave) return;
		const snapshot = draft;
		saveFlow.mutate(
			{ projectId, name, flow: snapshot },
			{
				onSuccess: (issues) => {
					onSaved(snapshot, issues);
					const errors = issues.filter(
						(issue) => issue.severity === "error",
					).length;
					if (errors > 0) {
						toast.warning(
							`Saved with ${errors} ${errors === 1 ? "error" : "errors"}. Fix them before running.`,
						);
					} else {
						toast.success("Flow saved");
					}
				},
			},
		);
	}, [canSave, saveFlow, projectId, name, draft, onSaved]);

	const openFlow = useCallback(
		(flowName: string) =>
			void navigate({
				to: "/projects/$projectId/flows/$name",
				params: { projectId, name: flowName },
			}),
		[navigate, projectId],
	);

	// A new called flow: write it, point the node at it, save this flow, open it.
	const createCalled = useMutation(orpc.flows.save.mutationOptions());
	const createCalledFlow = async (nodeId: string, calledName: string) => {
		const node = draft.nodes.find((candidate) => candidate.id === nodeId);
		if (node?.type !== "subflow" && node?.type !== "foreach") return;
		try {
			await createCalled.mutateAsync({
				projectId,
				name: calledName,
				flow: node.type === "foreach" ? newElementFlow(node.as) : newFlow(),
			});
		} catch (error) {
			toast.error(
				`Could not create ${calledName}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}
		void queryClient.invalidateQueries({ queryKey: orpc.flows.list.key() });
		const next = updateNode(draft, nodeId, (current) =>
			current.type === "subflow" || current.type === "foreach"
				? { ...current, flow: calledName }
				: current,
		);
		setDraft(next);
		if (!isSavable(next)) {
			toast.info(
				`Created ${calledName}. Fix this flow's fields and save it, then open ${calledName} from the node.`,
			);
			return;
		}
		try {
			const issues = await saveFlow.mutateAsync({
				projectId,
				name,
				flow: next,
			});
			onSaved(next, issues);
		} catch {
			return;
		}
		toast.success(`Created ${calledName} and saved ${name}.`);
		// The save has not rendered yet; leaving must not ask about it.
		dirtyRef.current = false;
		openFlow(calledName);
	};

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				save();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [save]);

	// Leaving with unsaved changes asks first, in the app and on reload.
	const dirtyRef = useRef(dirty);
	dirtyRef.current = dirty;
	const blocker = useBlocker({
		shouldBlockFn: () => dirtyRef.current,
		enableBeforeUnload: () => dirtyRef.current,
		withResolver: true,
	});

	const runBlockedBy = dirty
		? "Save the flow first."
		: errorCount > 0
			? "Fix the errors first."
			: null;
	const callers = projectFlows.flows ? callersOf(name, projectFlows.flows) : [];

	const selectIssue = (issue: FlowIssue) => {
		if (issue.nodeId && draft.nodes.some((node) => node.id === issue.nodeId)) {
			setSelection({ kind: "node", id: issue.nodeId });
			void fitView({
				nodes: [{ id: issue.nodeId }],
				duration: 300,
				maxZoom: 1,
			});
			return;
		}
		const edge = draft.edges.find((candidate) => candidate.id === issue.edgeId);
		if (edge) {
			setSelection({ kind: "edge", id: edge.id });
			void fitView({
				nodes: [{ id: edge.from }, { id: edge.to }],
				duration: 300,
				maxZoom: 1,
			});
		}
	};

	const selectedNode =
		selection?.kind === "node"
			? draft.nodes.find((node) => node.id === selection.id)
			: undefined;
	const selectedEdge =
		selection?.kind === "edge"
			? draft.edges.find((edge) => edge.id === selection.id)
			: undefined;

	const renameSelected = (node: FlowNode) => (next: string) => {
		if (draft.nodes.some((other) => other.id === next)) {
			return `${next} is taken by another node.`;
		}
		if (draft.inputs.some((input) => input.name === next)) {
			return `${next} is an input of this flow. Node ids and inputs share one namespace.`;
		}
		if (next === "run") return "run is reserved for the run's fields.";
		setDraft((current) => renameNode(current, node.id, next));
		setSelection({ kind: "node", id: next });
		return null;
	};

	const renameSelectedOutcome =
		(node: FlowNode) => (index: number, name: string) => {
			setDraft((current) => renameOutcome(current, node.id, index, name));
			return null;
		};

	// Dropping a label drops its edges too: say so, and offer to put them back.
	const removeSelectedOutcome = (node: FlowNode) => (index: number) => {
		const result = removeOutcome(draft, node.id, index);
		const { option, dropped } = result;
		if (!option) return;
		setDraft((current) => removeOutcome(current, node.id, index).flow);
		if (dropped.length === 0) return;
		const noun = optionNoun(node);
		toast.info(
			`Removed the ${noun} ${outcomeLabel(option.name)} and ${dropped.length} ${dropped.length === 1 ? "edge" : "edges"} on it.`,
			{
				description: dropped
					.map((edge) => `${edge.from} → ${edge.to}`)
					.join(", "),
				action: {
					label: "Undo",
					onClick: () =>
						setDraft((current) =>
							restoreOutcome(current, node.id, index, option, dropped),
						),
				},
			},
		);
	};

	// Own outcomes on or off: edges on outcomes the node drops go too, with an undo.
	const setSelectedAgentOutcomes =
		(node: FlowNode) => (outcomes: NodeOption[] | undefined) => {
			const result = setAgentOutcomes(draft, node.id, outcomes);
			setDraft((current) => setAgentOutcomes(current, node.id, outcomes).flow);
			const { dropped, previous } = result;
			if (dropped.length === 0) return;
			toast.info(
				`Dropped ${dropped.length} ${dropped.length === 1 ? "edge" : "edges"} on outcomes ${node.id} no longer has.`,
				{
					description: dropped
						.map(
							(edge) =>
								`${edge.from} ${outcomeLabel(edge.outcome)} → ${edge.to}`,
						)
						.join(", "),
					action: {
						label: "Undo",
						onClick: () =>
							setDraft((current) =>
								restoreAgentOutcomes(current, node.id, previous, dropped),
							),
					},
				},
			);
		};

	return (
		<main className="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
				<nav
					aria-label="Breadcrumb"
					className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs"
				>
					<Link
						to="/projects/$projectId"
						params={{ projectId }}
						className="truncate outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
					>
						{projectName ?? "Project"}
					</Link>
					<ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
					<span>Flows</span>
					<ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
				</nav>
				<h1 className="font-medium font-mono text-sm">{name}</h1>
				{draft.inputs.length > 0 ? (
					<span
						className="hidden truncate font-mono text-muted-foreground text-xs sm:inline"
						title="The inputs of this flow"
					>
						(
						{draft.inputs
							.map(
								(input) =>
									`${input.name}${input.type === "json" ? ": json" : ""}`,
							)
							.join(", ")}
						)
					</span>
				) : null}
				{callers.length > 0 ? (
					<span className="hidden text-muted-foreground text-xs md:inline">
						Called by{" "}
						{callers.map((caller, index) => (
							<span key={caller}>
								{index > 0 ? ", " : null}
								<Link
									to="/projects/$projectId/flows/$name"
									params={{ projectId, name: caller }}
									className="font-mono underline-offset-2 hover:text-foreground hover:underline"
								>
									{caller}
								</Link>
							</span>
						))}
					</span>
				) : null}
				<div aria-live="polite" className="flex items-center gap-2">
					{dirty ? (
						<Badge variant="outline" className="text-status-interrupted">
							<CircleDotIcon aria-hidden="true" />
							Unsaved changes
						</Badge>
					) : (
						<span className="text-muted-foreground text-xs">Saved</span>
					)}
					{errorCount > 0 ? (
						<Badge variant="destructive">
							<CircleAlertIcon aria-hidden="true" />
							{errorCount} {errorCount === 1 ? "error" : "errors"}
						</Badge>
					) : null}
				</div>
				<div className="ml-auto flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={save}
						disabled={!canSave}
						title={
							savable
								? "Save (⌘/Ctrl + S)"
								: "Fix the fields marked in the issues first. The file would not load."
						}
					>
						<SaveIcon data-icon="inline-start" />
						{saveFlow.isPending ? "Saving…" : "Save"}
					</Button>
					<Button
						size="sm"
						onClick={() => setStarting(true)}
						disabled={runBlockedBy !== null}
						title={runBlockedBy ?? "Run this flow in a new worktree"}
					>
						<PlayIcon data-icon="inline-start" />
						Run
					</Button>
				</div>
			</header>

			<div className="grid min-h-0 auto-rows-max grid-cols-[minmax(0,1fr)] grid-rows-[60vh] overflow-y-auto md:grid-cols-[minmax(0,1fr)_22rem] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
				<ProjectFlowsContext.Provider value={projectFlows.flows}>
					<OpenFlowContext.Provider value={openFlow}>
						<EditorCanvas
							flow={draft}
							check={check}
							selection={selection}
							onFlowChange={changeFlow}
							onSelect={setSelection}
						/>
					</OpenFlowContext.Provider>
					<aside
						aria-label="Inspector"
						className="grid min-h-0 grid-rows-[1fr_auto] border-t md:border-t-0 md:border-l"
					>
						<div className="min-h-0 overflow-y-auto p-3">
							{selectedNode ? (
								<NodeInspector
									key={selectedNode.id}
									flow={draft}
									node={selectedNode}
									onChange={(change) =>
										setDraft((current) =>
											updateNode(current, selectedNode.id, change),
										)
									}
									onRename={renameSelected(selectedNode)}
									onRenameOutcome={renameSelectedOutcome(selectedNode)}
									onRemoveOutcome={removeSelectedOutcome(selectedNode)}
									onSetAgentOutcomes={setSelectedAgentOutcomes(selectedNode)}
									onSetStart={() =>
										setDraft((current) => ({
											...current,
											start: selectedNode.id,
										}))
									}
									onDelete={() => {
										setDraft((current) => removeNode(current, selectedNode.id));
										setSelection(null);
									}}
									calledFlows={{
										flowName: name,
										flows: projectFlows.flows,
										onOpen: openFlow,
										onCreate: (nodeId, calledName) =>
											void createCalledFlow(nodeId, calledName),
										creating: createCalled.isPending || saveFlow.isPending,
									}}
								/>
							) : selectedEdge ? (
								<EdgeInspector
									key={selectedEdge.id}
									flow={draft}
									edge={selectedEdge}
									onChange={(change) =>
										setDraft((current) =>
											updateEdge(current, selectedEdge.id, change),
										)
									}
									onDelete={() => {
										setDraft((current) => removeEdge(current, selectedEdge.id));
										setSelection(null);
									}}
								/>
							) : (
								<FlowInspector flow={draft} onChange={changeFlow} />
							)}
						</div>
						<div className="flex max-h-64 min-h-0 flex-col">
							<IssuesPanel check={check} onSelect={selectIssue} />
						</div>
					</aside>
				</ProjectFlowsContext.Provider>
			</div>

			<StartRunDialog
				open={starting}
				onOpenChange={setStarting}
				projectId={projectId}
				flowName={name}
				inputs={draft.inputs}
			/>

			<AlertDialog
				open={blocker.status === "blocked"}
				onOpenChange={(open) => {
					if (!open && blocker.status === "blocked") blocker.reset();
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Leave without saving?</AlertDialogTitle>
						<AlertDialogDescription>
							The changes to {name} are not saved. They are lost when you leave.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Stay</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => blocker.status === "blocked" && blocker.proceed()}
						>
							Leave
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</main>
	);
}
