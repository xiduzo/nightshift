// The flow editor: the canvas, the floating panels, the inspector of what
// is selected, saving, and the keys that act on the whole flow. Over 600
// lines because it wires every inspector (node, edge, Section, flow) to the
// one draft. The edits themselves live in `node-edits.ts`,
// `sections/section-edits.ts` and `@nightshift/flows`.

import type { Flow, FlowIssue, FlowNodeType } from "@nightshift/flows";
import {
	callersOf,
	isSavable,
	newElementFlow,
	newFlow,
	removeEdge,
	removeNode,
	sectionOf,
	updateEdge,
	updateNode,
	updateSection,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { ButtonGroup } from "@nightshift/ui/components/button-group";
import { Kbd, KbdGroup } from "@nightshift/ui/components/kbd";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import {
	CheckIcon,
	CircleDotIcon,
	type LucideIcon,
	PlayIcon,
	Redo2Icon,
	SaveIcon,
	SparklesIcon,
	Undo2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SiteHeader } from "@/shared/page";
import { FlowAssistantContext } from "../assistant/flow-assistant";
import { NODE_TYPE } from "../canvas/node-type";
import {
	EnterSubflowContext,
	OpenFlowContext,
} from "../canvas/open-flow-context";
import { useFoldedSections } from "../canvas/sections/use-section-canvas";
import type { ChatLink } from "../chat/chat-link";
import { FlowChatPanel } from "../chat/chat-panel";
import { ProposalBar } from "../chat/proposal-bar";
import { useChatPanel } from "../chat/use-chat-panel";
import { checkFlow } from "../flow-draft";
import { flowMutations, flowQueries } from "../queries";
import { StartRunDialog } from "../start/start-run-dialog";
import { useAddNode } from "./canvas-controls";
import { useFlowClipboard } from "./clipboard/use-flow-clipboard";
import { EdgeInspector } from "./edge-inspector";
import { type EditKeys, editKeyOf, leavesKeyToPage } from "./edit-keys";
import { EditorCanvas } from "./editor-canvas";
import { FloatingInspector } from "./floating-inspector";
import { FlowInspector } from "./flow-inspector";
import { FlowTitleCard } from "./flow-title-card";
import { useDraftHistory } from "./history/use-draft-history";
import { NodeInspector } from "./inspector/node-inspector";
import { IssuesPopover } from "./issues-popover";
import { LeaveDialog } from "./leave-dialog";
import { NodeDock } from "./node-dock";
import { nodeEdits } from "./node-edits";
import { ProjectFlowsContext } from "./project-flows-context";
import { MakeSubflowDialog } from "./sections/make-subflow-dialog";
import { sectionEdits } from "./sections/section-edits";
import { SectionInspector } from "./sections/section-inspector";
import { type Selection, selectedNodeIds, selectionIn } from "./selection";
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
	/** Opens the chat panel at the start: as it is, or a chat about a run. */
	chatLink?: ChatLink;
	/** The chat link did its work: drop it from the address. */
	onChatLinkUsed?: () => void;
};

/** What the chat panel covers of the canvas on a wide screen: its width (`w-[min(380px,…)]`) and its gap. */
const CHAT_PANEL_COVERS_PX = 380 + 12;

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
	chatLink,
	onChatLinkUsed,
}: Props) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { fitView } = useReactFlow();

	const { draft, setDraft, undo, redo, canUndo, canRedo, revision } =
		useDraftHistory(initialFlow);
	const [savedJson, setSavedJson] = useState(() =>
		initiallySaved ? JSON.stringify(initialFlow) : "",
	);
	const [selection, setSelection] = useState<Selection>(null);
	// The Section just made: its inspector asks for a name first.
	const [madeSection, setMadeSection] = useState<string | null>(null);
	// The Section "Make subflow" works on, while its dialog is open.
	const [subflowOf, setSubflowOf] = useState<string | null>(null);
	const folds = useFoldedSections(`${projectId}/${name}`);

	const dirty = useMemo(
		() => JSON.stringify(draft) !== savedJson,
		[draft, savedJson],
	);
	const {
		projectFlows,
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
		(change: (flow: Flow) => Flow, gesture?: string) =>
			setDraft(change, gesture),
		[setDraft],
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
			// Another flow of the project checks its Subflow nodes against this one.
			void queryClient.invalidateQueries({
				queryKey: flowQueries.map(projectId).queryKey,
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

	const sections = sectionEdits(draft, setDraft, setSelection, folds.setFolded);
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const subflowSection = draft.sections?.find(
		(section) => section.id === subflowOf,
	);
	const makeSection = (nodeIds: readonly string[]) => {
		const id = sections.makeSection(nodeIds);
		if (id) setMadeSection(id);
	};
	const makeSectionRef = useRef(makeSection);
	makeSectionRef.current = makeSection;
	const selectionRef = useRef(selection);
	selectionRef.current = selection;
	const clipboard = useFlowClipboard({
		draft,
		setDraft,
		selection,
		setSelection,
	});
	// The keys that edit the canvas: undo, redo, copy, cut and paste. Not
	// while a proposal or a Subflow is on view.
	const editKeysRef = useRef<EditKeys | null>(null);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const mod = event.metaKey || event.ctrlKey;
			const key = event.key.toLowerCase();
			if (key === "s" && mod) {
				event.preventDefault();
				save();
			}
			const edit = editKeyOf(event);
			const edits = editKeysRef.current;
			if (edit && edits && !leavesKeyToPage(event, edit)) {
				if (edits[edit]()) event.preventDefault();
				return;
			}
			// Cmd/Ctrl+G: make a Section of the selected nodes.
			if (key === "g" && mod && !event.shiftKey && !event.altKey) {
				const target = event.target as HTMLElement | null;
				if (target?.closest("input, textarea, [contenteditable='true']"))
					return;
				const ids = selectedNodeIds(selectionRef.current);
				if (ids.length === 0) return;
				event.preventDefault();
				makeSectionRef.current(ids);
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

	const selectNode = (nodeId: string) => {
		// A node inside a folded Section shows again.
		const holder = sectionOf(draft, nodeId);
		if (holder && folds.folded.has(holder.id))
			folds.setFolded(holder.id, false);
		setSelection({ kind: "node", id: nodeId });
		void fitView({ nodes: [{ id: nodeId }], duration: 300, maxZoom: 1 });
	};

	const selectIssue = (issue: FlowIssue) => {
		if (issue.nodeId && draft.nodes.some((node) => node.id === issue.nodeId)) {
			selectNode(issue.nodeId);
			return;
		}
		const issueSection = draft.sections?.find(
			(section) => section.id === issue.sectionId,
		);
		if (issueSection) {
			setSelection({ kind: "section", id: issueSection.id });
			void fitView({
				nodes: [{ id: `section:${issueSection.id}` }],
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
	const selectedSection =
		selection?.kind === "section"
			? draft.sections?.find((section) => section.id === selection.id)
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

	// The field helpers of the inspector: they read the draft and change it.
	const assistant = {
		projectId,
		flowName: name,
		flow: draft,
		readFlow: () => draftRef.current,
		changeFlow,
	};
	// The chat beside the canvas, and the proposal the canvas shows instead of the draft.
	const chat = useChatPanel(assistant, {
		openAtStart: !initiallySaved,
		link: chatLink,
		onLinkUsed: onChatLinkUsed,
	});
	const preview = chat.preview;
	editKeysRef.current =
		preview || subflows.inside
			? null
			: {
					undo: () => {
						if (canUndo) undo();
						return canUndo;
					},
					redo: () => {
						if (canRedo) redo();
						return canRedo;
					},
					...clipboard,
				};

	const previewCheck = useMemo(
		() =>
			preview &&
			checkFlow(
				preview.proposed,
				projectFlows.flows,
				name,
				connectionNames,
				profileNames,
			),
		[preview, projectFlows.flows, name, connectionNames, profileNames],
	);

	const inspector = selectedNode ? (
		<NodeInspector
			key={selectedNode.id}
			projectId={projectId}
			flow={draft}
			node={selectedNode}
			onChange={(change) =>
				setDraft(
					(current) => updateNode(current, selectedNode.id, change),
					`node:${selectedNode.id}`,
				)
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
			onSelectEdge={(id) => setSelection({ kind: "edge", id })}
			onChange={(change) =>
				setDraft(
					(current) => updateEdge(current, selectedEdge.id, change),
					`edge:${selectedEdge.id}`,
				)
			}
			onDelete={() => {
				setDraft((current) => removeEdge(current, selectedEdge.id));
				setSelection(null);
			}}
		/>
	) : selectedSection ? (
		<SectionInspector
			key={selectedSection.id}
			flow={draft}
			section={selectedSection}
			issues={check.issues.filter(
				(issue) => issue.sectionId === selectedSection.id,
			)}
			folded={folds.folded.has(selectedSection.id)}
			autoFocus={madeSection === selectedSection.id}
			onChange={(change) =>
				setDraft(
					(current) => updateSection(current, selectedSection.id, change),
					`section:${selectedSection.id}`,
				)
			}
			onSetFolded={(folded) =>
				sections.setSectionFolded(selectedSection.id, folded)
			}
			onRemove={() => sections.removeWithUndo(selectedSection.id)}
			onSelectNode={selectNode}
			onMakeSubflow={() => setSubflowOf(selectedSection.id)}
		/>
	) : settingsOpen ? (
		<FlowInspector
			flow={draft}
			name={name}
			policyDefaults={policyDefaults}
			onChange={(change) => setDraft(change, "settings")}
		/>
	) : null;

	// An undo or a redo can take away what is selected.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on each undo or redo only.
	useEffect(() => {
		setSelection((current) => selectionIn(draftRef.current, current));
	}, [revision]);

	const closeInspector = useCallback(() => {
		setSelection(null);
		setSettingsOpen(false);
	}, []);
	const inspectorOpen = inspector !== null && !preview;
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
				<ButtonGroup aria-label="History">
					<HistoryButton
						label="Undo"
						keys={["⌘/Ctrl", "Z"]}
						icon={Undo2Icon}
						onClick={undo}
						disabled={!canUndo || preview !== null}
					/>
					<HistoryButton
						label="Redo"
						keys={["⌘/Ctrl", "Shift", "Z"]}
						icon={Redo2Icon}
						onClick={redo}
						disabled={!canRedo || preview !== null}
					/>
				</ButtonGroup>
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
					variant={chat.open ? "secondary" : "outline"}
					size="sm"
					aria-pressed={chat.open}
					onClick={chat.toggle}
				>
					<SparklesIcon data-icon="inline-start" />
					Build with an agent
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
									// A proposal is its own canvas: it fits the view anew,
									// and keeps no routes of the draft.
									key={preview ? "proposal" : "draft"}
									flow={preview?.flow ?? draft}
									routesKey={`${projectId}/${name}${preview ? "#proposal" : ""}`}
									check={previewCheck ?? check}
									selection={preview ? null : selection}
									folded={folds.folded}
									onFlowChange={preview ? ignoreChange : changeFlow}
									preview={preview ?? undefined}
									// A fit keeps the flow beside the chat, not under it.
									coveredRight={chat.open ? CHAT_PANEL_COVERS_PX : 0}
									onSelect={setSelection}
									onSetFolded={sections.setSectionFolded}
									onMakeSection={makeSection}
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
						{preview ? (
							<ProposalBar
								onHide={chat.hidePreview}
								className="pointer-events-auto absolute bottom-3 left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2"
							/>
						) : (
							<>
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
							</>
						)}
						{dragging ? (
							<div className="absolute inset-3 flex items-end justify-center rounded-xl border-2 border-primary/40 border-dashed pb-20">
								<span className="rounded-full bg-background px-3 py-1 text-muted-foreground text-xs shadow-sm">
									Drop to add the {NODE_TYPE[dragging].label} node here
								</span>
							</div>
						) : null}
						{chat.open ? (
							<FlowChatPanel
								{...chat.panel}
								className="pointer-events-auto absolute top-3 right-3 bottom-3 w-[min(380px,calc(100%-1.5rem))]"
							/>
						) : null}
						{inspector && !preview ? (
							<FloatingInspector
								label={selection ? "Selected" : "Flow settings"}
								onClose={closeInspector}
								className={cn(
									"absolute top-3 right-3 bottom-3 w-[min(400px,calc(100%-1.5rem))]",
									// Beside the chat on a wide screen, over it on a narrow one.
									chat.open && "lg:right-[calc(380px+1.5rem)]",
								)}
							>
								<FlowAssistantContext.Provider value={assistant}>
									{/* An undo or a redo starts the fields again from the draft. */}
									<div key={`${selectionKey(selection)}#${revision}`}>
										{inspector}
									</div>
								</FlowAssistantContext.Provider>
							</FloatingInspector>
						) : null}
					</div>

					{subflows.inside ? (
						<OpenFlowContext.Provider value={openFlow}>
							<SubflowView
								projectId={projectId}
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

			{subflowSection ? (
				<MakeSubflowDialog
					open
					onOpenChange={(open) => {
						if (!open) setSubflowOf(null);
					}}
					projectId={projectId}
					flowName={name}
					draft={draft}
					section={subflowSection}
					flows={projectFlows.flows}
					onMade={(made) => {
						sections.applySubflow(
							subflowSection.id,
							made,
							() => draftRef.current,
						);
						// The Subflow view reads the new flow from the project's list.
						void queryClient.invalidateQueries({
							queryKey: flowQueries.lists(),
						});
					}}
				/>
			) : null}

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

/** Undo or Redo in the header, with its keys in the tooltip. */
function HistoryButton({
	label,
	keys,
	icon: Icon,
	onClick,
	disabled,
}: {
	label: string;
	keys: string[];
	icon: LucideIcon;
	onClick: () => void;
	disabled: boolean;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="outline"
						size="icon-sm"
						aria-label={label}
						onClick={onClick}
						disabled={disabled}
					/>
				}
			>
				<Icon />
			</TooltipTrigger>
			<TooltipContent>
				{label}
				<KbdGroup>
					{keys.map((key) => (
						<Kbd key={key}>{key}</Kbd>
					))}
				</KbdGroup>
			</TooltipContent>
		</Tooltip>
	);
}

/** The canvas of a proposal is read only. */
function ignoreChange() {}

function selectionKey(selection: Selection): string {
	if (!selection) return "flow";
	return selection.kind === "nodes"
		? `nodes:${selection.ids.join(",")}`
		: `${selection.kind}:${selection.id}`;
}
