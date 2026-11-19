// The panels that float over the canvas: the title card, the bars, the dock, the issues, the chat and the inspector.

import type { callersOf, Flow, FlowIssue } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { cn } from "@nightshift/ui/lib/utils";
import { HistoryIcon } from "lucide-react";
import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { CopyProjectHere, notHere } from "@/features/projects";
import { hoverTime } from "@/shared/format";
import type { FlowAssistant } from "../assistant";
import { FlowAssistantContext } from "../assistant";
import { NodeSamplesContext, type useSubflowStack } from "../canvas";
import { FlowChatPanel, ProposalBar, type useChatPanel } from "../chat";
import type { TestMarksApi } from "../test-run";
import { FollowingBar, TestMarksContext } from "../test-run";
import type { CatalogEntry } from "./add-node";
import { NodeDock, type useNodeAdder } from "./add-node";
import type { checkFlow } from "./draft";
import { FlowTitleCard } from "./flow-title-card";
import { FloatingInspector } from "./inspector";
import { IssuesPopover } from "./issues-popover";
import type { useRevisionView } from "./revisions";
import type { selectedInspector } from "./selected-inspector";
import type { EditingSession, Selection } from "./session";
import type { useNodeSamples } from "./use-node-samples";

/**
 * What floats over the canvas: the title card, the proposal, revision or
 * test run bar, the dock, the issues, the drop frame, the chat and the
 * inspector. Hidden while a Subflow is on view.
 */
export function EditorPanels({
	subflows,
	projectId,
	name,
	draft,
	callers,
	settingsOpen,
	selection,
	setSettingsOpen,
	session,
	shownRevision,
	setShownRevision,
	setRevisionsOpen,
	preview,
	chat,
	testRunId,
	setTestRunId,
	nodeAdder,
	setDragging,
	check,
	selectIssue,
	dragging,
	project,
	inspector,
	closeInspector,
	assistant,
	revision,
	samples,
	testMarks,
}: {
	subflows: ReturnType<typeof useSubflowStack>;
	projectId: string;
	name: string;
	draft: Flow;
	callers: ReturnType<typeof callersOf>;
	settingsOpen: boolean;
	selection: Selection;
	setSettingsOpen: Dispatch<SetStateAction<boolean>>;
	session: EditingSession;
	shownRevision: ReturnType<typeof useRevisionView>["shownRevision"];
	setShownRevision: ReturnType<typeof useRevisionView>["setShownRevision"];
	setRevisionsOpen: Dispatch<SetStateAction<boolean>>;
	preview: ReturnType<typeof useChatPanel>["preview"];
	chat: ReturnType<typeof useChatPanel>;
	testRunId: string | null;
	setTestRunId: Dispatch<SetStateAction<string | null>>;
	nodeAdder: ReturnType<typeof useNodeAdder>;
	setDragging: Dispatch<SetStateAction<CatalogEntry | null>>;
	check: ReturnType<typeof checkFlow>;
	selectIssue: (issue: FlowIssue) => void;
	dragging: CatalogEntry | null;
	project: ComponentProps<typeof CopyProjectHere>["project"] | undefined;
	inspector: ReturnType<typeof selectedInspector>;
	closeInspector: () => void;
	assistant: FlowAssistant;
	revision: number;
	samples: ReturnType<typeof useNodeSamples>;
	testMarks: TestMarksApi;
}) {
	return (
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
	);
}

function selectionKey(selection: Selection): string {
	if (!selection) return "flow";
	return selection.kind === "nodes"
		? `nodes:${selection.ids.join(",")}:${(selection.sections ?? []).join(",")}`
		: `${selection.kind}:${selection.id}`;
}
