// The dialogs of the editor: Start run, Make subflow, the revisions, Copy and Leave.

import type { Flow } from "@nightshift/flows";
import type { useBlocker } from "@tanstack/react-router";
import type { Dispatch, SetStateAction } from "react";
import type { useChatPanel } from "../chat";
import { CopyFlowDialog } from "../move";
import { StartRunDialog } from "../start";
import type { TestMarksApi } from "../test-run";
import type { useRevisionView } from "./revisions";
import { RevisionsSheet } from "./revisions";
import type { useFlowSave } from "./saving";
import { LeaveDialog } from "./saving";
import { MakeSubflowDialog, type sectionEdits } from "./sections";
import type { EditingSession } from "./session";
import type { useEditorData } from "./use-editor-data";

/** The editor's dialogs and sheet: Start run, Make subflow, Revisions, Copy into project and Leave. */
export function EditorDialogs({
	starting,
	setStarting,
	projectId,
	name,
	draft,
	testMarks,
	setTestRunId,
	subflowSection,
	setSubflowOf,
	projectFlows,
	sections,
	revisionsOpen,
	setRevisionsOpen,
	openRevision,
	setOpenRevision,
	dirty,
	chat,
	session,
	setShownRevision,
	onSaved,
	copying,
	setCopying,
	blocker,
}: {
	starting: boolean;
	setStarting: Dispatch<SetStateAction<boolean>>;
	projectId: string;
	name: string;
	draft: Flow;
	testMarks: TestMarksApi;
	setTestRunId: Dispatch<SetStateAction<string | null>>;
	subflowSection: NonNullable<Flow["sections"]>[number] | undefined;
	setSubflowOf: Dispatch<SetStateAction<string | null>>;
	projectFlows: ReturnType<typeof useEditorData>["projectFlows"];
	sections: ReturnType<typeof sectionEdits>;
	revisionsOpen: boolean;
	setRevisionsOpen: Dispatch<SetStateAction<boolean>>;
	openRevision: string | null;
	setOpenRevision: Dispatch<SetStateAction<string | null>>;
	dirty: boolean;
	chat: ReturnType<typeof useChatPanel>;
	session: EditingSession;
	setShownRevision: ReturnType<typeof useRevisionView>["setShownRevision"];
	onSaved: ReturnType<typeof useFlowSave>["onSaved"];
	copying: boolean;
	setCopying: Dispatch<SetStateAction<boolean>>;
	blocker: ReturnType<typeof useBlocker>;
}) {
	return (
		<>
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
