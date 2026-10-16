import type { Flow, FlowIssue, FlowNode, Policy } from "@nightshift/flows";
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
import { Card } from "@nightshift/ui/components/card";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@nightshift/ui/components/resizable";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { CheckIcon, CircleDotIcon, PlayIcon, SaveIcon } from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { toast } from "sonner";

import { OpenFlowContext } from "@/components/flow/open-flow-context";
import { outcomeLabel } from "@/components/outcome-badge";
import { StartRunDialog } from "@/components/run/start-run-dialog";
import { SiteHeader } from "@/components/site-header";
import { useProjectFlows } from "@/hooks/use-project-flows";
import {
	addEdge,
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
import { EditorCanvas, NodePalette, type Selection } from "./editor-canvas";
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
	// The daemon's settings (new-node defaults, run policy) and connections.
	const settings = useQuery(orpc.settings.get.queryOptions());
	const daemonConnections = useQuery(orpc.connections.list.queryOptions());
	const nodeDefaults = settings.data?.values;
	const policyDefaults = useMemo((): Required<Policy> | undefined => {
		const values = settings.data?.values;
		if (!values) return undefined;
		return {
			usageLimitFirstWaitMinutes: values.usageLimitFirstWaitMinutes,
			usageLimitMaxWaitMinutes: values.usageLimitMaxWaitMinutes,
			networkGraceMinutes: values.networkGraceMinutes,
			maxSteps: values.maxStepsPerRun,
		};
	}, [settings.data]);
	const connections = daemonConnections.data?.connections;
	const connectionNames = useMemo(
		() => connections?.map((connection) => connection.name),
		[connections],
	);
	const check = useMemo(
		() => checkFlow(draft, projectFlows.flows, name, connectionNames),
		[draft, projectFlows.flows, name, connectionNames],
	);
	const [starting, setStarting] = useState(false);
	const savable = useMemo(() => isSavable(draft), [draft]);
	const wide = useMediaQuery("(min-width: 1024px)");
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
				flow:
					node.type === "foreach"
						? newElementFlow(node.as, nodeDefaults)
						: newFlow(nodeDefaults),
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

	const flowsSupport = {
		flowName: name,
		flows: projectFlows.flows,
		onOpen: openFlow,
		onCreate: (nodeId: string, calledName: string) =>
			void createCalledFlow(nodeId, calledName),
		creating: createCalled.isPending || saveFlow.isPending,
	};

	const inspector = selectedNode ? (
		<NodeInspector
			key={selectedNode.id}
			flow={draft}
			node={selectedNode}
			onChange={(change) =>
				setDraft((current) => updateNode(current, selectedNode.id, change))
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
			calledFlows={flowsSupport}
			connections={connections}
			edges={{
				onAdd: (outcome, to) =>
					setDraft(
						(current) =>
							addEdge(current, selectedNode.id, outcome, to)?.flow ?? current,
					),
				onSelect: (edgeId) => setSelection({ kind: "edge", id: edgeId }),
				onDelete: (edgeId) =>
					setDraft((current) => removeEdge(current, edgeId)),
			}}
		/>
	) : selectedEdge ? (
		<EdgeInspector
			key={selectedEdge.id}
			flow={draft}
			edge={selectedEdge}
			onChange={(change) =>
				setDraft((current) => updateEdge(current, selectedEdge.id, change))
			}
			onDelete={() => {
				setDraft((current) => removeEdge(current, selectedEdge.id));
				setSelection(null);
			}}
		/>
	) : (
		<FlowInspector
			flow={draft}
			name={name}
			policyDefaults={policyDefaults}
			onChange={changeFlow}
		/>
	);

	return (
		<>
			<SiteHeader
				crumbs={[
					{ label: "Home", link: { to: "/" } },
					{
						label: projectName ?? "Project",
						link: { to: "/projects/$projectId", params: { projectId } },
					},
					{ label: <span className="font-mono">{name}</span> },
				]}
			>
				<div
					aria-live="polite"
					className="sr-only sm:not-sr-only sm:flex sm:items-center"
				>
					{dirty ? (
						<Badge
							variant="outline"
							className="border-status-waiting/40 bg-status-waiting/10 text-status-waiting"
						>
							<CircleDotIcon aria-hidden="true" />
							Unsaved changes
						</Badge>
					) : (
						<Badge variant="outline" className="text-muted-foreground">
							<CheckIcon aria-hidden="true" />
							Saved
						</Badge>
					)}
				</div>
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
					{saveFlow.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<SaveIcon data-icon="inline-start" />
					)}
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
			</SiteHeader>

			<ProjectFlowsContext.Provider value={projectFlows.flows}>
				<div className="flex h-[calc(100svh-3.5rem)] min-h-0 flex-col">
					<ResizablePanelGroup
						key={wide ? "wide" : "narrow"}
						orientation={wide ? "horizontal" : "vertical"}
						className="min-h-0 flex-1"
					>
						<ResizablePanel
							id="canvas"
							defaultSize={wide ? "70%" : "58%"}
							minSize={wide ? "35%" : 200}
							className="flex min-h-0 min-w-0 flex-col gap-3 p-3 pb-1.5 lg:p-4 lg:pr-2"
						>
							<div className="@container flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
								<NodePalette
									flow={draft}
									onFlowChange={changeFlow}
									onSelect={setSelection}
									defaults={nodeDefaults}
								/>
								<FlowSignature
									projectId={projectId}
									inputs={draft.inputs}
									callers={callers}
								/>
							</div>
							<div className="min-h-0 flex-1">
								<OpenFlowContext.Provider value={openFlow}>
									<EditorCanvas
										flow={draft}
										check={check}
										selection={selection}
										onFlowChange={changeFlow}
										onSelect={setSelection}
									/>
								</OpenFlowContext.Provider>
							</div>
							<IssuesPanel
								check={check}
								onSelect={selectIssue}
								defaultOpen={wide}
							/>
						</ResizablePanel>
						<ResizableHandle
							withHandle
							className="bg-transparent focus-visible:bg-ring"
						/>
						<ResizablePanel
							id="inspector"
							defaultSize={wide ? "30%" : "42%"}
							minSize={wide ? 320 : 160}
							maxSize={wide ? "55%" : undefined}
							className="min-h-0 min-w-0 p-3 pt-1.5 lg:p-4 lg:pl-2"
						>
							<aside aria-label="Inspector" className="h-full">
								<Card className="h-full gap-0 py-0">
									<ScrollArea className="h-full min-h-0">
										<div key={selectionKey(selection)}>{inspector}</div>
									</ScrollArea>
								</Card>
							</aside>
						</ResizablePanel>
					</ResizablePanelGroup>
				</div>
			</ProjectFlowsContext.Provider>

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
							The changes to <span className="font-mono">{name}</span> are not
							saved. They are lost when you leave.
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
		</>
	);
}

function selectionKey(selection: Selection): string {
	return selection ? `${selection.kind}:${selection.id}` : "flow";
}

/** True while the viewport is at least `query` wide; follows resizes. */
function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const list = window.matchMedia(query);
			list.addEventListener("change", onChange);
			return () => list.removeEventListener("change", onChange);
		},
		() => window.matchMedia(query).matches,
		() => true,
	);
}

/** The flow's inputs, like a function signature, and the flows that call it. */
function FlowSignature({
	projectId,
	inputs,
	callers,
}: {
	projectId: string;
	inputs: Flow["inputs"];
	callers: string[];
}) {
	if (inputs.length === 0 && callers.length === 0) return null;
	return (
		<div className="ml-auto @xl:flex hidden min-w-0 items-center gap-3 text-muted-foreground text-xs">
			{inputs.length > 0 ? (
				<span
					className="flex min-w-0 items-center gap-1.5"
					title="The inputs of this flow"
				>
					<span className="shrink-0">Inputs</span>
					<span className="flex min-w-0 flex-wrap gap-1">
						{inputs.map((input) => (
							<Badge
								key={input.name}
								variant="outline"
								className="font-mono font-normal"
							>
								{input.name}
								{input.type === "json" ? (
									<span className="text-muted-foreground">: json</span>
								) : null}
							</Badge>
						))}
					</span>
				</span>
			) : null}
			{callers.length > 0 ? (
				<span className="flex min-w-0 items-center gap-1">
					<span className="shrink-0">Called by</span>
					{callers.map((caller) => (
						<Button
							key={caller}
							variant="link"
							size="xs"
							className="h-auto px-0.5 font-mono text-muted-foreground hover:text-foreground"
							nativeButton={false}
							render={
								<Link
									to="/projects/$projectId/flows/$name"
									params={{ projectId, name: caller }}
								/>
							}
						>
							{caller}
						</Button>
					))}
				</span>
			) : null}
		</div>
	);
}
