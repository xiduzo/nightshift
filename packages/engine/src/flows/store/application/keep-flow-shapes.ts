import type { StepShapes } from "../domain/inferred";
import type { Clock, FlowStore, ProjectSpaces, ThisDevice } from "./ports";

export type KeepFlowShapesPorts = {
	store: Pick<FlowStore, "keepShapes">;
	projects: ProjectSpaces;
	device: ThisDevice;
	clock: Clock;
};

/**
 * Keeps the shapes of a run's step on its node, as an output schema marked
 * inferred, with one revision of kind `infer` by Night Shift on this
 * Device. Only while the node has no schema, on a flow of this format:
 * anything else writes nothing. The Walker asks it when a step ends with
 * `shapes`. Returns whether it wrote a revision.
 */
export const keepFlowShapes =
	(ports: KeepFlowShapesPorts) =>
	async (request: {
		projectId: string;
		name: string;
		node: { id: string; type: string };
		shapes: StepShapes;
	}): Promise<boolean> => {
		await ports.projects.spaceOf(request.projectId);
		const deviceId = await ports.device.id();
		return ports.store.keepShapes(request.projectId, {
			name: request.name,
			node: request.node,
			shapes: request.shapes,
			deviceId,
			at: ports.clock(),
		});
	};
