// The inspector of what is selected: a node, an edge, a Section, or the flow's settings.

import type { Flow } from "@nightshift/flows";
import {
	removeEdge,
	removeNode,
	updateEdge,
	updateNode,
	updateSection,
} from "@nightshift/flows";
import type { Dispatch, SetStateAction } from "react";
import type { checkFlow } from "./draft";
import { EdgeInspector, FlowInspector, NodeInspector } from "./inspector";
import { nodeEdits } from "./node-edits";
import { SectionInspector, type sectionEdits } from "./sections";
import type { EditingSession } from "./session";
import type { useCalledFlows } from "./use-called-flows";
import type { useEditorData } from "./use-editor-data";

/**
 * The inspector of the selected node, edge or Section, or of the flow's
 * settings while they are open and nothing is selected. Null when none
 * shows: a function, not a component, so the editor can ask.
 */
export function selectedInspector({
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
}: {
	selectedNode: Flow["nodes"][number] | undefined;
	selectedEdge: Flow["edges"][number] | undefined;
	selectedSection: NonNullable<Flow["sections"]>[number] | undefined;
	settingsOpen: boolean;
	projectId: string;
	name: string;
	draft: Flow;
	session: EditingSession;
	flowsSupport: ReturnType<typeof useCalledFlows>["flowsSupport"];
	connections: ReturnType<typeof useEditorData>["connections"];
	policyDefaults: ReturnType<typeof useEditorData>["policyDefaults"];
	check: ReturnType<typeof checkFlow>;
	madeSection: string | null;
	sections: ReturnType<typeof sectionEdits>;
	selectNode: (nodeId: string) => void;
	setSubflowOf: Dispatch<SetStateAction<string | null>>;
}) {
	const {
		renameSelected,
		renameSelectedOutcome,
		removeSelectedOutcome,
		setSelectedCallEach,
		setSelectedAgentOutcomes,
	} = nodeEdits(session);

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
	return inspector;
}
