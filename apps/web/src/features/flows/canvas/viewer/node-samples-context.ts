import type { NodeSample } from "@nightshift/client";
import { createContext } from "react";

/**
 * What each node of the flow in the editor gave in its newest runs, by
 * node id (`useNodeSamples`), for the node inspector and the template
 * picker. A node without an entry was not in those runs. Null where
 * nothing shows samples: the flow has no run yet, or the field is not in
 * the editor.
 */
export const NodeSamplesContext = createContext<ReadonlyMap<
	string,
	NodeSample
> | null>(null);
