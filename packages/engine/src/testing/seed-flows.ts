import { flowSchema, type Schedule } from "@nightshift/flows";
import type { SpaceFlows } from "../flows";
import type { SpaceEngine } from "../space-engine";

/**
 * Gives a project these flows, by name, in its flow document, as a person
 * saves them. With `schedules`, its schedules too.
 */
export async function seedFlows(
	engine: { flows: Pick<SpaceFlows, "save"> } & Pick<
		SpaceEngine,
		"saveSchedules"
	>,
	projectId: string,
	flows: Readonly<Record<string, unknown>>,
	schedules?: readonly Schedule[],
): Promise<void> {
	for (const [name, json] of Object.entries(flows)) {
		await engine.flows.save(projectId, name, flowSchema.parse(json));
	}
	if (schedules !== undefined) {
		await engine.saveSchedules(projectId, schedules);
	}
}
