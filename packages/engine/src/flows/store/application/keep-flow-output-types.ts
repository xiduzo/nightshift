import type { OutputType } from "../domain/inferred";
import type { Clock, FlowStore, ProjectSpaces, ThisDevice } from "./ports";

export type KeepFlowOutputTypesPorts = {
	store: Pick<FlowStore, "keepOutputTypes">;
	projects: ProjectSpaces;
	device: ThisDevice;
	clock: Clock;
};

/**
 * Keeps the types a run gave the outputs of a flow, each marked inferred,
 * with one revision of kind `infer` by Night Shift on this Device. Only on
 * an output that has no type and the template the run read: anything else
 * writes nothing. The Walker asks it when a Call of that flow finished.
 * Returns whether it wrote a revision.
 */
export const keepFlowOutputTypes =
	(ports: KeepFlowOutputTypesPorts) =>
	async (request: {
		projectId: string;
		name: string;
		types: readonly OutputType[];
	}): Promise<boolean> => {
		await ports.projects.spaceOf(request.projectId);
		const deviceId = await ports.device.id();
		return ports.store.keepOutputTypes(request.projectId, {
			name: request.name,
			types: request.types,
			deviceId,
			at: ports.clock(),
		});
	};
