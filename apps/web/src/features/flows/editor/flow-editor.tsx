import type { Flow, FlowIssue } from "@nightshift/flows";
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
import { Card } from "@nightshift/ui/components/card";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@nightshift/ui/components/resizable";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { CheckIcon, CircleDotIcon, PlayIcon, SaveIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useMediaQuery } from "@/shared/media-query";
import { SiteHeader } from "@/shared/page";
import { OpenFlowContext } from "../canvas/open-flow-context";
import { checkFlow } from "../flow-draft";
import { flowMutations, flowQueries } from "../queries";
import { StartRunDialog } from "../start/start-run-dialog";
import { EdgeInspector } from "./edge-inspector";
import { EditorCanvas, NodePalette, type Selection } from "./editor-canvas";
import { FlowInspector } from "./flow-inspector";
import { FlowSignature } from "./flow-signature";
import { NodeInspector } from "./inspector/node-inspector";
import { IssuesPanel } from "./issues-panel";
import { LeaveDialog } from "./leave-dialog";
import { nodeEdits } from "./node-edits";
import { ProjectFlowsContext } from "./project-flows-context";
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
	const wide = useMediaQuery("(min-width: 1024px)", true);
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
									variables={draft.variables ?? []}
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
