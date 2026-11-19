// The flow editor: the canvas, the floating panels, the inspector of what
// is selected, saving, and the keys that act on the whole flow. Over 600
// lines because it wires every inspector (node, edge, Section, flow) to the
// one draft. The draft, its history, the selection and the open Section
// live in the editing session (`session/editing-session.ts`). The edits
// themselves live in `node-edits.ts`, `sections/section-edits.ts` and
// `@nightshift/flows`.

import type { Flow, FlowIssue } from "@nightshift/flows";
import {
	callersOf,
	isSavable,
	removeEdge,
	removeNode,
	updateEdge,
	updateNode,
	updateSection,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { cn } from "@nightshift/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import {
	CopyIcon,
	DownloadIcon,
	HistoryIcon,
	MoreHorizontalIcon,
	PlayIcon,
	Redo2Icon,
	Undo2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyProjectHere, notHere, projectQueries } from "@/features/projects";
import { AgentButton } from "@/shared/agent-button";
import { hoverTime } from "@/shared/format";
import { SiteHeader } from "@/shared/page";
import { FlowAssistantContext } from "../assistant";
import {
	DeviceNamesContext,
	EnterSubflowContext,
	NodeSamplesContext,
	OpenFlowContext,
	useSubflowStack,
} from "../canvas";
import type { ChatLink } from "../chat";
import {
	FlowChatPanel,
	ProposalBar,
	proposalCanvas,
	useChatPanel,
} from "../chat";
import { CopyFlowDialog } from "../move";
import { StartRunDialog } from "../start";
import {
	FollowingBar,
	TestBadge,
	TestMarksContext,
	useTestMarks,
} from "../test-run";
import type { CatalogEntry } from "./add-node";
import { NodeDock, useNodeAdder } from "./add-node";
import { useFlowClipboard } from "./clipboard";
import { checkFlow } from "./draft";
import { EditorCanvas } from "./editing-canvas";
import { FlowTitleCard } from "./flow-title-card";
import {
	EdgeInspector,
	FloatingInspector,
	FlowInspector,
	NodeInspector,
} from "./inspector";
import { IssuesPopover } from "./issues-popover";
import { LeaveDialog } from "./leave-dialog";
import { nodeEdits } from "./node-edits";
import { ProjectFlowsContext, ProjectFolderContext } from "./project";
import { RevisionsSheet, useRevisionView } from "./revisions";
import { SaveButton } from "./save-button";
import { MakeSubflowDialog, SectionInspector, sectionEdits } from "./sections";
import {
	createEditingSession,
	type Selection,
	useEditingSession,
} from "./session";
import { SubflowView } from "./subflow-view";
import { useCalledFlows } from "./use-called-flows";
import { useEditorData } from "./use-editor-data";
import { useEditorKeys, useEscapeCloses } from "./use-editor-keys";
import { useFlowSave } from "./use-flow-save";
import { useNodeSamples } from "./use-node-samples";

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
	/** Opens the revisions at the start, with this revision open. */
	revisionLink?: string;
	/** The revision link did its work: drop it from the address. */
	onRevisionLinkUsed?: () => void;
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
	revisionLink,
	onRevisionLinkUsed,
}: Props) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { fitView } = useReactFlow();

	// The draft, its undo history, what was saved last, what is selected
	// and which Section is open.
	const [session] = useState(() =>
		createEditingSession(initialFlow, { saved: initiallySaved }),
	);
	const {
		draft,
		canUndo,
		canRedo,
		revision,
		dirty,
		everSaved,
		selection,
		openSection,
		madeSection,
	} = useEditingSession(session);
	const {
		revisionsOpen,
		setRevisionsOpen,
		openRevision,
		setOpenRevision,
		shownRevision,
		setShownRevision,
	} = useRevisionView({ revisionLink, onRevisionLinkUsed });
	const [copying, setCopying] = useState(false);
	// The Section "Make subflow" works on, while its dialog is open.
	const [subflowOf, setSubflowOf] = useState<string | null>(null);

	const {
		projectFlows,
		nodeDefaults,
		policyDefaults,
		connections,
		place,
		deviceNames,
		folder,
	} = useEditorData(projectId, name);
	// The pins and skips of a test run, kept in this browser.
	const testMarks = useTestMarks({ projectId, flowName: name, flow: draft });
	// The test run started here: the viewers show it until you leave it.
	const [testRunId, setTestRunId] = useState<string | null>(null);
	// What each node gave in the flow's newest runs, or in that test run: the viewers.
	const samples = useNodeSamples({
		projectId,
		flowName: name,
		flow: draft,
		runId: testRunId ?? undefined,
	});
	const check = useMemo(() => checkFlow(draft, place), [draft, place]);
	const [starting, setStarting] = useState(false);
	const savable = useMemo(() => isSavable(draft), [draft]);
	// The flow's settings show in the inspector while nothing is selected.
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [dragging, setDragging] = useState<CatalogEntry | null>(null);
	const errorCount = check.issues.filter(
		(issue) => issue.severity === "error",
	).length;

	const { saveFlow, exportFlow, onSaved, save } = useFlowSave({
		session,
		queryClient,
		projectId,
		name,
		draft,
		dirty,
		savable,
	});

	const { openFlow, flowsSupport } = useCalledFlows({
		navigate,
		projectId,
		name,
		draft,
		nodeDefaults,
		session,
		saveFlow,
		onSaved,
		projectFlows,
	});

	const sections = useMemo(() => sectionEdits(session), [session]);
	const subflowSection = draft.sections?.find(
		(section) => section.id === subflowOf,
	);
	const clipboard = useFlowClipboard(session);
	const { editKeysRef } = useEditorKeys({ save, session, sections });

	// Leaving with unsaved changes asks first, in the app and on reload.
	const blocker = useBlocker({
		shouldBlockFn: () => session.get().dirty,
		enableBeforeUnload: () => session.get().dirty,
		withResolver: true,
	});

	const runBlockedBy = dirty
		? "Save the flow first."
		: errorCount > 0
			? "Fix the errors first."
			: null;
	const callers = projectFlows.flows ? callersOf(name, projectFlows.flows) : [];

	const selectNode = (nodeId: string) => {
		// A node inside a Section shows in its open Section.
		if (session.selectNode(nodeId))
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
			session.select({ kind: "section", id: issueSection.id });
			void fitView({
				nodes: [{ id: `section:${issueSection.id}` }],
				duration: 300,
				maxZoom: 1,
			});
			return;
		}
		const edge = draft.edges.find((candidate) => candidate.id === issue.edgeId);
		if (edge) {
			session.select({ kind: "edge", id: edge.id });
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
			session.select(null);
			setSettingsOpen(false);
		},
	});

	const {
		renameSelected,
		renameSelectedOutcome,
		removeSelectedOutcome,
		setSelectedCallEach,
		setSelectedAgentOutcomes,
	} = nodeEdits(session);

	// The field helpers of the inspector: they read the draft and change it.
	const assistant = {
		projectId,
		flowName: name,
		flow: draft,
		readFlow: () => session.get().draft,
		changeFlow: session.edit,
	};
	// The agent reads the project's folder: without one here, it says how to get it.
	const project = useQuery(projectQueries.list()).data?.find(
		(p) => p.id === projectId,
	);
	// The chat beside the canvas, and the proposal the canvas shows instead of the draft.
	const chat = useChatPanel(assistant, {
		openAtStart: !initiallySaved,
		link: chatLink,
		onLinkUsed: onChatLinkUsed,
	});
	const revisionPreview = useMemo(
		() =>
			shownRevision
				? proposalCanvas(shownRevision.before, shownRevision.after)
				: null,
		[shownRevision],
	);
	const preview = revisionPreview ?? chat.preview;
	// Once a render shows a change, something picked outside the open
	// Section shows the whole flow again. Not while a proposal is on view.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs after each render that changed the draft, the selection or the open Section.
	useEffect(() => {
		if (!preview) session.settle();
	}, [session, preview, draft, selection, openSection]);
	editKeysRef.current =
		preview || subflows.inside
			? null
			: {
					undo: session.undo,
					redo: session.redo,
					...clipboard,
				};

	// The node grid, the dock's recent nodes and a drop: Tab, a double-click on the canvas, or the dock.
	const nodeAdder = useNodeAdder({
		session,
		projectId,
		flowName: name,
		flows: projectFlows.flows,
		defaults: nodeDefaults,
		disabled: Boolean(preview) || subflows.inside,
	});

	const previewCheck = useMemo(
		() => preview && checkFlow(preview.proposed, place),
		[preview, place],
	);

	const inspector = selectedNode ? (
		<NodeInspector
			key={selectedNode.id}
			projectId={projectId}
			flow={draft}
			node={selectedNode}
			onChange={(change) =>
				session.edit(
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
				session.edit((current) => ({
					...current,
					start: selectedNode.id,
				}))
			}
			onDelete={() => {
				session.edit((current) => removeNode(current, selectedNode.id));
				session.select(null);
			}}
			calledFlows={flowsSupport}
			connections={connections}
		/>
	) : selectedEdge ? (
		<EdgeInspector
			key={selectedEdge.id}
			flow={draft}
			edge={selectedEdge}
			onSelectEdge={(id) => session.select({ kind: "edge", id })}
			onChange={(change) =>
				session.edit(
					(current) => updateEdge(current, selectedEdge.id, change),
					`edge:${selectedEdge.id}`,
				)
			}
			onDelete={() => {
				session.edit((current) => removeEdge(current, selectedEdge.id));
				session.select(null);
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
			autoFocus={madeSection === selectedSection.id}
			onChange={(change) =>
				session.edit(
					(current) => updateSection(current, selectedSection.id, change),
					`section:${selectedSection.id}`,
				)
			}
			onOpen={() => session.openSection(selectedSection.id)}
			onRemove={() => sections.removeWithUndo(selectedSection.id)}
			onSelectNode={selectNode}
			onMakeSubflow={() => setSubflowOf(selectedSection.id)}
		/>
	) : settingsOpen ? (
		<FlowInspector
			flow={draft}
			name={name}
			projectId={projectId}
			policyDefaults={policyDefaults}
			onChange={(change) => session.edit(change, "settings")}
		/>
	) : null;

	const closeInspector = useCallback(() => {
		session.select(null);
		setSettingsOpen(false);
	}, [session]);
	const inspectorOpen = inspector !== null && !preview;
	useEscapeCloses({ inspectorOpen, starting, closeInspector });

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
				<SaveButton
					state={
						saveFlow.isPending
							? "saving"
							: !dirty
								? "saved"
								: !savable
									? "blocked"
									: saveFlow.isError
										? "failed"
										: "unsaved"
					}
					onClick={save}
				/>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="outline"
								size="icon-sm"
								aria-label={`More actions for ${name}`}
							/>
						}
					>
						<MoreHorizontalIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-56">
						<DropdownMenuGroup>
							<DropdownMenuItem
								disabled={!canUndo || preview !== null}
								onClick={() => session.undo()}
							>
								<Undo2Icon aria-hidden="true" />
								Undo
								<DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={!canRedo || preview !== null}
								onClick={() => session.redo()}
							>
								<Redo2Icon aria-hidden="true" />
								Redo
								<DropdownMenuShortcut>⇧⌘Z</DropdownMenuShortcut>
							</DropdownMenuItem>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => {
								setShownRevision(null);
								setRevisionsOpen(true);
							}}
						>
							<HistoryIcon aria-hidden="true" />
							Revisions
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							disabled={!everSaved}
							onClick={() => void exportFlow()}
						>
							<DownloadIcon aria-hidden="true" />
							Export as file
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={!everSaved}
							onClick={() => setCopying(true)}
						>
							<CopyIcon aria-hidden="true" />
							Copy into project…
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<AgentButton
					entry="flow.build"
					variant={chat.open ? "secondary" : "outline"}
					aria-pressed={chat.open}
					onClick={chat.toggle}
				/>
				<TestBadge test={testMarks} onSelectNode={selectNode} />
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

			<DeviceNamesContext.Provider value={deviceNames}>
				<ProjectFlowsContext.Provider value={projectFlows.flows}>
					<ProjectFolderContext.Provider value={folder}>
						<div className="relative h-[calc(100svh-3.5rem)] min-h-0">
							<div className="absolute inset-0" inert={subflows.inside}>
								<OpenFlowContext.Provider value={openFlow}>
									<EnterSubflowContext.Provider value={subflows.enter}>
										<EditorCanvas
											// A proposal is its own canvas: it fits the view anew,
											// and keeps no routes of the draft.
											key={
												revisionPreview
													? `revision:${shownRevision?.revisionId}`
													: preview
														? "proposal"
														: "draft"
											}
											flow={preview?.flow ?? draft}
											routesKey={`${projectId}/${name}${revisionPreview ? `#revision:${shownRevision?.revisionId}` : preview ? "#proposal" : ""}`}
											check={previewCheck ?? check}
											selection={preview ? null : selection}
											onFlowChange={preview ? ignoreChange : session.edit}
											preview={preview ?? undefined}
											// A fit keeps the flow beside the chat, not under it.
											coveredRight={chat.open ? CHAT_PANEL_COVERS_PX : 0}
											onSelect={session.select}
											onMakeSection={sections.makeSection}
											onDropNode={nodeAdder.drop}
											onNodeDoubleClick={subflows.enterNode}
											onPaneDoubleClick={nodeAdder.show}
											openSection={preview ? null : openSection}
											onOpenSection={session.openSection}
											flowLabel={name}
											samples={samples}
											test={testMarks}
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
										session.select(null);
									}}
									className="pointer-events-auto absolute top-3 left-3 w-[min(24rem,calc(100%-1.5rem))]"
								/>
								{shownRevision ? (
									<ProposalBar
										title={`What the revision of ${hoverTime(shownRevision.at)} changed`}
										onHide={() => setShownRevision(null)}
										className="pointer-events-auto absolute bottom-3 left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2"
									>
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												setShownRevision(null);
												setRevisionsOpen(true);
											}}
										>
											<HistoryIcon data-icon="inline-start" />
											Back to revisions
										</Button>
									</ProposalBar>
								) : preview ? (
									<ProposalBar
										onHide={chat.hidePreview}
										className="pointer-events-auto absolute bottom-3 left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2"
									/>
								) : (
									<>
										{testRunId ? (
											<FollowingBar
												runId={testRunId}
												onShowNewest={() => setTestRunId(null)}
												className="pointer-events-auto absolute bottom-3 left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2"
											/>
										) : null}
										<NodeDock
											adder={nodeAdder}
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
									<div className="absolute inset-3 flex items-end justify-center rounded-xl border-2 border-dashed border-primary/40 pb-20">
										<span className="rounded-full bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm">
											{dragging.add.kind === "node"
												? `Drop to add the ${dragging.label} node here`
												: `Drop to add ${dragging.label} here`}
										</span>
									</div>
								) : null}
								{chat.open ? (
									<FlowChatPanel
										{...chat.panel}
										notice={
											project && notHere(project) ? (
												<CopyProjectHere project={project} />
											) : null
										}
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
												<NodeSamplesContext.Provider value={samples}>
													<TestMarksContext.Provider value={testMarks}>
														{inspector}
													</TestMarksContext.Provider>
												</NodeSamplesContext.Provider>
											</div>
										</FlowAssistantContext.Provider>
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
					</ProjectFolderContext.Provider>
				</ProjectFlowsContext.Provider>
			</DeviceNamesContext.Provider>

			<StartRunDialog
				open={starting}
				onOpenChange={setStarting}
				projectId={projectId}
				flowName={name}
				inputs={draft.inputs}
				test={
					testMarks.count.total > 0
						? {
								marks: testMarks.marks,
								skippedGates: draft.nodes
									.filter(
										(node) =>
											node.type === "decision" &&
											node.by === "person" &&
											Object.hasOwn(testMarks.marks.skipped, node.id),
									)
									.map((node) => node.id),
								onStarted: setTestRunId,
							}
						: undefined
				}
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
					onMade={(made) => sections.applySubflow(subflowSection.id, made)}
				/>
			) : null}

			<RevisionsSheet
				projectId={projectId}
				name={name}
				open={revisionsOpen}
				onOpenChange={setRevisionsOpen}
				selectedId={openRevision}
				onSelect={setOpenRevision}
				dirty={dirty}
				onShow={(revision) => {
					chat.hidePreview();
					session.select(null);
					setRevisionsOpen(false);
					setShownRevision(revision);
				}}
				onRestored={(flow, issues) => {
					session.edit(flow);
					onSaved(flow, issues);
					setShownRevision(null);
				}}
			/>

			<CopyFlowDialog
				open={copying}
				onOpenChange={setCopying}
				projectId={projectId}
				name={name}
				dirty={dirty}
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

/** The canvas of a proposal is read only. */
function ignoreChange() {}

function selectionKey(selection: Selection): string {
	if (!selection) return "flow";
	return selection.kind === "nodes"
		? `nodes:${selection.ids.join(",")}:${(selection.sections ?? []).join(",")}`
		: `${selection.kind}:${selection.id}`;
}
