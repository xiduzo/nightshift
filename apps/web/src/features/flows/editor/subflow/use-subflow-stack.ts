import type { Flow } from "@nightshift/flows";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	enterSubflow,
	leaveSubflowTo,
	type SubflowStack,
	type SubflowViewport,
	subflowKey,
} from "./subflow-stack";

/** Where a key press belongs to a field, a menu, a list or a dialog, not the canvas. */
const FIELD_SELECTOR =
	"input, textarea, select, [contenteditable='true'], [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-slot$='-content']";

/** Reads a key press for the Subflow keys: `i` goes in, `u` or Escape goes up. */
export function readSubflowKey(event: KeyboardEvent): "in" | "up" | null {
	const target = event.target as HTMLElement | null;
	return subflowKey({
		key: event.key,
		metaKey: event.metaKey,
		ctrlKey: event.ctrlKey,
		altKey: event.altKey,
		defaultPrevented: event.defaultPrevented,
		inField: Boolean(target?.closest?.(FIELD_SELECTOR)),
	});
}

/**
 * The Subflows you look inside from the editor's flow (`flow`). `i` looks
 * inside the selected Call node (`selectedNodeId`), `u` or Escape goes one
 * level up. `beforeEnter` runs before each step in, for example to clear the
 * editor's selection so no key edits the flow under the read-only view.
 */
export function useSubflowStack({
	flow,
	selectedNodeId,
	beforeEnter,
}: {
	flow: Flow;
	selectedNodeId: string | null;
	beforeEnter: () => void;
}) {
	const [stack, setStack] = useState<SubflowStack>([]);
	const beforeEnterRef = useRef(beforeEnter);
	beforeEnterRef.current = beforeEnter;

	const enter = useCallback(
		(nodeId: string, called: string, viewport?: SubflowViewport) => {
			if (called === "") return;
			beforeEnterRef.current();
			setStack((current) =>
				enterSubflow(current, { nodeId, flow: called }, viewport),
			);
		},
		[],
	);
	const goTo = useCallback(
		(depth: number) => setStack((current) => leaveSubflowTo(current, depth)),
		[],
	);

	/** The node of the editor's flow, when it is a Subflow that names a flow. */
	const callOf = useCallback(
		(nodeId: string | null) => {
			const node = flow.nodes.find((candidate) => candidate.id === nodeId);
			return node?.type === "call" && node.flow !== "" ? node : null;
		},
		[flow.nodes],
	);
	const enterNode = useCallback(
		(nodeId: string) => {
			const node = callOf(nodeId);
			if (node) enter(node.id, node.flow);
		},
		[callOf, enter],
	);
	const selected = useMemo(
		() => callOf(selectedNodeId),
		[callOf, selectedNodeId],
	);

	const depth = stack.length;
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const key = readSubflowKey(event);
			if (key === "up" && depth > 0) {
				event.preventDefault();
				goTo(depth - 1);
			} else if (key === "in" && depth === 0 && selected) {
				event.preventDefault();
				enter(selected.id, selected.flow);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [depth, selected, enter, goTo]);

	return { stack, inside: depth > 0, enter, enterNode, goTo };
}
