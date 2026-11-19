// The flow editor: the canvas, the floating panels, the inspector of what
// is selected, saving, and the keys that act on the whole flow. `Editor`
// wires each of them to the one draft: a hook or a component beside this
// file holds each. The draft, its history, the selection and the open
// Section live in the editing session (`session/editing-session.ts`).
// The edits themselves live in `node-edits.ts`, `sections/section-edits.ts`
// and `@nightshift/flows`.

import type { Flow, FlowIssue } from "@nightshift/flows";
import { callersOf, isSavable } from "@nightshift/flows";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { projectQueries } from "@/features/projects";
import {
	DeviceNamesContext,
	EnterSubflowContext,
	OpenFlowContext,
	useSubflowStack,
} from "../canvas";
import type { ChatLink } from "../chat";
import { proposalCanvas, useChatPanel } from "../chat";
import { useTestMarks } from "../test-run";
import type { CatalogEntry } from "./add-node";
import { useNodeAdder } from "./add-node";
import { useFlowClipboard } from "./clipboard";
import { checkFlow } from "./draft";
import { EditorCanvas } from "./editing-canvas";
import { EditorDialogs } from "./editor-dialogs";
import { EditorHeader } from "./editor-header";
import { EditorPanels } from "./editor-panels";
import { ProjectFlowsContext, ProjectFolderContext } from "./project";
import { useRevisionView } from "./revisions";
import { sectionEdits } from "./sections";
import { selectedInspector } from "./selected-inspector";
import { createEditingSession, useEditingSession } from "./session";
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

	const inspector = selectedInspector({
		selectedNode,
		selectedEdge,
		selectedSection,
		settingsOpen,
		projectId,
		name,
		draft,
		session,
		flowsSupport,
		connections,
		policyDefaults,
		check,
		madeSection,
		sections,
		selectNode,
		setSubflowOf,
	});

	const closeInspector = useCallback(() => {
		session.select(null);
		setSettingsOpen(false);
	}, [session]);
	const inspectorOpen = inspector !== null && !preview;
	useEscapeCloses({ inspectorOpen, starting, closeInspector });

	return (
		<>
			<EditorHeader
				projectName={projectName}
				projectId={projectId}
				name={name}
				saveFlow={saveFlow}
				dirty={dirty}
				savable={savable}
				save={save}
				canUndo={canUndo}
				canRedo={canRedo}
				preview={preview}
				session={session}
				setShownRevision={setShownRevision}
				setRevisionsOpen={setRevisionsOpen}
				everSaved={everSaved}
				exportFlow={exportFlow}
				setCopying={setCopying}
				chat={chat}
				testMarks={testMarks}
				selectNode={selectNode}
				setStarting={setStarting}
				runBlockedBy={runBlockedBy}
			/>

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
							<EditorPanels
								subflows={subflows}
								projectId={projectId}
								name={name}
								draft={draft}
								callers={callers}
								settingsOpen={settingsOpen}
								selection={selection}
								setSettingsOpen={setSettingsOpen}
								session={session}
								shownRevision={shownRevision}
								setShownRevision={setShownRevision}
								setRevisionsOpen={setRevisionsOpen}
								preview={preview}
								chat={chat}
								testRunId={testRunId}
								setTestRunId={setTestRunId}
								nodeAdder={nodeAdder}
								setDragging={setDragging}
								check={check}
								selectIssue={selectIssue}
								dragging={dragging}
								project={project}
								inspector={inspector}
								closeInspector={closeInspector}
								assistant={assistant}
								revision={revision}
								samples={samples}
								testMarks={testMarks}
							/>

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

			<EditorDialogs
				starting={starting}
				setStarting={setStarting}
				projectId={projectId}
				name={name}
				draft={draft}
				testMarks={testMarks}
				setTestRunId={setTestRunId}
				subflowSection={subflowSection}
				setSubflowOf={setSubflowOf}
				projectFlows={projectFlows}
				sections={sections}
				revisionsOpen={revisionsOpen}
				setRevisionsOpen={setRevisionsOpen}
				openRevision={openRevision}
				setOpenRevision={setOpenRevision}
				dirty={dirty}
				chat={chat}
				session={session}
				setShownRevision={setShownRevision}
				onSaved={onSaved}
				copying={copying}
				setCopying={setCopying}
				blocker={blocker}
			/>
		</>
	);
}

/** The canvas of a proposal is read only. */
function ignoreChange() {}
