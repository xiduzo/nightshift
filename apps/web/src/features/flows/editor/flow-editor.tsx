import type { Flow, FlowIssue, FlowNodeType } from "@nightshift/flows";
import {
	callersOf,
	isSavable,
	newElementFlow,
	newFlow,
	removeEdge,
	removeNode,
	updateEdge,
	updateNode,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { CheckIcon, CircleDotIcon, PlayIcon, SaveIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SiteHeader } from "@/shared/page";
import { NODE_TYPE } from "../canvas/node-type";
import {
	EnterSubflowContext,
	OpenFlowContext,
} from "../canvas/open-flow-context";
import { checkFlow } from "../flow-draft";
import { flowMutations, flowQueries } from "../queries";
import { StartRunDialog } from "../start/start-run-dialog";
import { EdgeInspector } from "./edge-inspector";
import { EditorCanvas, type Selection, useAddNode } from "./editor-canvas";
import { FloatingInspector } from "./floating-inspector";
import { FlowInspector } from "./flow-inspector";
import { FlowTitleCard } from "./flow-title-card";
import { NodeInspector } from "./inspector/node-inspector";
import { IssuesPopover } from "./issues-popover";
import { LeaveDialog } from "./leave-dialog";
import { NodeDock } from "./node-dock";
import { nodeEdits } from "./node-edits";
import { ProjectFlowsContext } from "./project-flows-context";
import { SubflowView } from "./subflow/subflow-view";
import { useSubflowStack } from "./subflow/use-subflow-stack";
import { useEditorData } from "./use-editor-data";

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
	const {
		projectFlows,
		devices,
		nodeDefaults,
		policyDefaults,
		connections,
		connectionNames,
		profileNames,
	} = useEditorData(projectId, name);
	const check = useMemo(
		() =>
			checkFlow(draft, projectFlows.flows, name, connectionNames, profileNames),
		[draft, projectFlows.flows, name, connectionNames, profileNames],
	);
	const [starting, setStarting] = useState(false);
	const savable = useMemo(() => isSavable(draft), [draft]);
	// The flow's settings show in the inspector while nothing is selected.
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [dragging, setDragging] = useState<FlowNodeType | null>(null);
	const addNode = useAddNode(draft, setDraft, setSelection, nodeDefaults);
	const errorCount = check.issues.filter(
		(issue) => issue.severity === "error",
	).length;

	const changeFlow = useCallback(
		(change: (flow: Flow) => Flow) => setDraft(change),
		[],
	);

	const saveFlow = useMutation(
		flowMutations.save({
			onError: (error) => toast.error(`Could not save: ${error.message}`),
		}),
	);

	const canSave = dirty && savable && !saveFlow.isPending;

	/** After a save: the draft is the file now, and the cached flow follows. */
	const onSaved = useCallback(
		(snapshot: Flow, issues: FlowIssue[]) => {
			setSavedJson(JSON.stringify(snapshot));
			queryClient.setQueryData(
				flowQueries.get(projectId, name).queryKey,
				(loaded) => (loaded ? { ...loaded, flow: snapshot, issues } : loaded),
			);
			void queryClient.invalidateQueries({
				queryKey: flowQueries.lists(),
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
	const createCalled = useMutation(flowMutations.save());
	const createCalledFlow = async (nodeId: string, calledName: string) => {
		const node = draft.nodes.find((candidate) => candidate.id === nodeId);
		if (node?.type !== "call") return;
		try {
			await createCalled.mutateAsync({
				projectId,
				name: calledName,
				flow: node.each
					? newElementFlow(node.each.as, nodeDefaults)
					: newFlow(nodeDefaults),
			});
		} catch (error) {
			toast.error(
				`Could not create ${calledName}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}
		void queryClient.invalidateQueries({ queryKey: flowQueries.lists() });
		const next = updateNode(draft, nodeId, (current) =>
			current.type === "call" ? { ...current, flow: calledName } : current,
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

	// Looking inside a Subflow: the canvas shows its flow, read only. Nothing
	// stays selected here, so no key edits this flow under that view.
	const subflows = useSubflowStack({
		flow: draft,
		selectedNodeId: selectedNode?.id ?? null,
		beforeEnter: () => {
			setSelection(null);
			setSettingsOpen(false);
		},
	});

	const {
		renameSelected,
		renameSelectedOutcome,
		removeSelectedOutcome,
		setSelectedCallEach,
		setSelectedAgentOutcomes,
	} = nodeEdits(draft, setDraft, setSelection);

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
			projectId={projectId}
			flow={draft}
			node={selectedNode}
			devices={devices}
			onChange={(change) =>
				setDraft((current) => updateNode(current, selectedNode.id, change))
			}
			onRename={renameSelected(selectedNode)}
			onRenameOutcome={renameSelectedOutcome(selectedNode)}
			onRemoveOutcome={removeSelectedOutcome(selectedNode)}
			onSetAgentOutcomes={setSelectedAgentOutcomes(selectedNode)}
			onSetCallEach={setSelectedCallEach(selectedNode)}
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
	) : settingsOpen ? (
		<FlowInspector
			flow={draft}
			name={name}
			policyDefaults={policyDefaults}
			onChange={changeFlow}
		/>
	) : null;

	const closeInspector = useCallback(() => {
		setSelection(null);
		setSettingsOpen(false);
	}, []);
	const inspectorOpen = inspector !== null;
	// Escape closes the inspector, but not while you type in a field or a
	// menu, a list or a dialog has the focus: Escape closes those first.
	useEffect(() => {
		if (!inspectorOpen || starting) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			const target = event.target as HTMLElement | null;
			if (
				target?.closest(
					"input, textarea, select, [contenteditable='true'], [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-slot$='-content']",
				)
			)
				return;
			closeInspector();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [inspectorOpen, starting, closeInspector]);

	return (
		<>
			<SiteHeader
				crumbs={[
					{ label: "Home", link: { to: "/" } },
					{
						label: projectName ?? "Project",
						link: { to: "/projects/$projectId", params: { projectId } },
					},
					{
						label: "Flows",
						link: { to: "/projects/$projectId/flows", params: { projectId } },
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
							: "Fix the fields marked in the issues first."
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
					title={runBlockedBy ?? "Run this flow"}
				>
					<PlayIcon data-icon="inline-start" />
					Run
				</Button>
			</SiteHeader>

			<ProjectFlowsContext.Provider value={projectFlows.flows}>
				<div className="relative h-[calc(100svh-3.5rem)] min-h-0">
					<div className="absolute inset-0" inert={subflows.inside}>
						<OpenFlowContext.Provider value={openFlow}>
							<EnterSubflowContext.Provider value={subflows.enter}>
								<EditorCanvas
									flow={draft}
									check={check}
									selection={selection}
									onFlowChange={changeFlow}
									onSelect={setSelection}
									onDropNode={addNode}
									onNodeDoubleClick={subflows.enterNode}
								/>
							</EnterSubflowContext.Provider>
						</OpenFlowContext.Provider>
					</div>

					{/* The panels float over the canvas; the gaps between them pass
					    clicks and drops through to it. */}
					<div
						className="pointer-events-none absolute inset-0"
						hidden={subflows.inside}
					>
						<FlowTitleCard
							projectId={projectId}
							name={name}
							flow={draft}
							callers={callers}
							settingsOpen={settingsOpen && selection === null}
							onToggleSettings={() => {
								// With a node selected, the button shows the settings.
								setSettingsOpen((open) => selection !== null || !open);
								setSelection(null);
							}}
							className="pointer-events-auto absolute top-3 left-3 w-[min(24rem,calc(100%-1.5rem))]"
						/>
						<NodeDock
							onAdd={(type) => addNode(type)}
							onDragChange={setDragging}
							className="pointer-events-auto absolute top-1/2 left-3 -translate-y-1/2"
						/>
						<IssuesPopover
							check={check}
							onSelect={selectIssue}
							className="pointer-events-auto absolute right-3 bottom-3 lg:top-3 lg:right-auto lg:bottom-auto lg:left-1/2 lg:-translate-x-1/2"
						/>
						{dragging ? (
							<div className="absolute inset-3 flex items-end justify-center rounded-xl border-2 border-primary/40 border-dashed pb-20">
								<span className="rounded-full bg-background px-3 py-1 text-muted-foreground text-xs shadow-sm">
									Drop to add the {NODE_TYPE[dragging].label} node here
								</span>
							</div>
						) : null}
						{inspector ? (
							<FloatingInspector
								label={selection ? "Selected" : "Flow settings"}
								onClose={closeInspector}
								className="pointer-events-auto absolute top-3 right-3 bottom-3 w-[min(400px,calc(100%-1.5rem))]"
							>
								<div key={selectionKey(selection)}>{inspector}</div>
							</FloatingInspector>
						) : null}
					</div>

					{subflows.inside ? (
						<OpenFlowContext.Provider value={openFlow}>
							<SubflowView
								rootFlow={name}
								stack={subflows.stack}
								flows={projectFlows.flows}
								onEnter={subflows.enter}
								onGoTo={subflows.goTo}
								onEdit={openFlow}
							/>
						</OpenFlowContext.Provider>
					) : null}
				</div>
			</ProjectFlowsContext.Provider>

			<StartRunDialog
				open={starting}
				onOpenChange={setStarting}
				projectId={projectId}
				flowName={name}
				inputs={draft.inputs}
			/>

			<LeaveDialog
				blocked={blocker.status === "blocked"}
				name={name}
				onStay={() => {
					if (blocker.status === "blocked") blocker.reset();
				}}
				onLeave={() => {
					if (blocker.status === "blocked") blocker.proceed();
				}}
			/>
		</>
	);
}

function selectionKey(selection: Selection): string {
	return selection ? `${selection.kind}:${selection.id}` : "flow";
}
