// elkjs is big, so it loads on the first "Lay out", not with the editor. It
// runs in a Web Worker: the page stays responsive while it lays out.

import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { ElkLayout } from "./flow-layout";

let loading: Promise<ElkLayout> | undefined;

/** ELK in a Web Worker, loaded once. A failed load is tried again next time. */
export function loadElk(): Promise<ElkLayout> {
	loading ??= Promise.all([
		import("elkjs/lib/elk-api.js"),
		// The worker script as it ships, served as a file of its own.
		import("elkjs/lib/elk-worker.min.js?url"),
	])
		.then(([{ default: ELK }, { default: workerUrl }]) => {
			const elk = new ELK({ workerUrl });
			const layout: ElkLayout = (graph: ElkNode) => elk.layout(graph);
			return layout;
		})
		.catch((error: unknown) => {
			loading = undefined;
			throw error;
		});
	return loading as Promise<ElkLayout>;
}
