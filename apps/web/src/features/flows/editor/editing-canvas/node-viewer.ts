import type { NodeSample } from "@nightshift/client";
import type { FlowNode } from "@nightshift/flows";
import type { FlowNodeData } from "../../canvas";
import { markedLine, sampleLine } from "../../canvas";
import { markOf, type TestMarks } from "../../test-run";

/**
 * What a node's card shows of the runs: its pinned output or the outcome
 * it takes in a test run, else what it gave in the newest runs.
 */
export function viewerOf(
	node: FlowNode,
	samples: ReadonlyMap<string, NodeSample> | null | undefined,
	marks: TestMarks | undefined,
	pinned: ReadonlyMap<string, NodeSample> | undefined,
): Pick<FlowNodeData, "sample" | "mark"> {
	const mark = marks ? markOf(marks, node.id) : null;
	if (mark?.kind === "skipped")
		return { mark, sample: markedLine(node, mark, undefined) };
	if (mark?.kind === "pinned") {
		const sample = pinned?.get(node.id);
		return {
			mark: { kind: "pinned", outcome: sample?.outcome ?? null },
			sample: markedLine(node, mark, sample),
		};
	}
	return samples ? { sample: sampleLine(node, samples.get(node.id)) } : {};
}
