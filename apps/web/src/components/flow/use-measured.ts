import type { NodeChange } from "@xyflow/react";
import { useCallback, useState } from "react";

export type Measured = Record<string, { width: number; height: number }>;

/**
 * React Flow measures nodes and reports the sizes as `dimensions` changes. A
 * canvas that derives its nodes from other state must hand the sizes back on
 * every node, or React Flow treats the node as unmeasured and hides it.
 */
export function useMeasured() {
	const [measured, setMeasured] = useState<Measured>({});
	const applyDimensions = useCallback((changes: NodeChange[]) => {
		const sized = changes.flatMap((change) =>
			change.type === "dimensions" && change.dimensions
				? [{ id: change.id, dimensions: change.dimensions }]
				: [],
		);
		if (sized.length === 0) return;
		setMeasured((current) => {
			const next = { ...current };
			for (const { id, dimensions } of sized) next[id] = dimensions;
			return next;
		});
	}, []);
	return [measured, applyDimensions] as const;
}
