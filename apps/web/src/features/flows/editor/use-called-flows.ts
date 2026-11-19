// The flows the Subflow nodes call: open one, or make one and point the node at it.

import type { Flow } from "@nightshift/flows";
import {
	isSavable,
	kitFlow,
	newElementFlow,
	newFlow,
	updateNode,
} from "@nightshift/flows";
import { useMutation } from "@tanstack/react-query";
import type { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { toast } from "sonner";
import { flowMutations } from "../queries";
import type { EditingSession } from "./session";
import type { useEditorData } from "./use-editor-data";
import type { useFlowSave } from "./use-flow-save";

/**
 * The flows the Subflow nodes call: open one, or make a new one (blank,
 * or a copy of a kit), point the node at it, and save this flow.
 * `flowsSupport` gives the node inspector all of it.
 */
export function useCalledFlows({
	navigate,
	projectId,
	name,
	draft,
	nodeDefaults,
	session,
	saveFlow,
	onSaved,
	projectFlows,
}: {
	navigate: ReturnType<typeof useNavigate>;
	projectId: string;
	name: string;
	draft: Flow;
	nodeDefaults: ReturnType<typeof useEditorData>["nodeDefaults"];
	session: EditingSession;
	saveFlow: ReturnType<typeof useFlowSave>["saveFlow"];
	onSaved: ReturnType<typeof useFlowSave>["onSaved"];
	projectFlows: ReturnType<typeof useEditorData>["projectFlows"];
}) {
	const openFlow = useCallback(
		(flowName: string) =>
			void navigate({
				to: "/projects/$projectId/flows/$name",
				params: { projectId, name: flowName },
			}),
		[navigate, projectId],
	);

	// A new called flow: write it, point the node at it, save this flow, open it.
	// With `copy`, the new flow is a copy of that kit.
	const createCalled = useMutation(flowMutations.save());
	const createCalledFlow = async (
		nodeId: string,
		calledName: string,
		copy?: { kit: string; flow: Flow },
	) => {
		const node = draft.nodes.find((candidate) => candidate.id === nodeId);
		if (node?.type !== "call") return;
		try {
			await createCalled.mutateAsync({
				projectId,
				name: calledName,
				flow: copy
					? copy.flow
					: node.each
						? newElementFlow(node.each.as, nodeDefaults)
						: newFlow(nodeDefaults),
			});
		} catch (error) {
			toast.error(
				`Could not ${copy ? `copy ${copy.kit}` : `create ${calledName}`}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}
		const next = updateNode(draft, nodeId, (current) =>
			current.type === "call" ? { ...current, flow: calledName } : current,
		);
		session.edit(next);
		if (!isSavable(next)) {
			toast.info(
				`Created ${calledName}. Fix and save this flow, then open ${calledName} from the node.`,
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
		toast.success(
			copy
				? `Copied ${copy.kit} into this project as ${calledName}, and saved ${name}.`
				: `Created ${calledName} and saved ${name}.`,
		);
		openFlow(calledName);
	};

	const flowsSupport = {
		flowName: name,
		flows: projectFlows.flows,
		onOpen: openFlow,
		onCreate: (nodeId: string, calledName: string) =>
			void createCalledFlow(nodeId, calledName),
		onCopyKit: (nodeId: string, kit: string, copyName: string) => {
			const flow = kitFlow(kit);
			if (flow) void createCalledFlow(nodeId, copyName, { kit, flow });
		},
		creating: createCalled.isPending || saveFlow.isPending,
	};
	return { openFlow, flowsSupport };
}
