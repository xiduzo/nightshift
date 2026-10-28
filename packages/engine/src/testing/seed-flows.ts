import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { flowSchema, migrateFlow, type Schedule } from "@nightshift/flows";
import type { SpaceEngine } from "../run/space-engine";

/**
 * Gives a project these flows, by name, in its flow document, as a person
 * saves them: an older version migrates first. With `schedules`, its
 * schedules too.
 */
export async function seedFlows(
	engine: Pick<SpaceEngine, "saveFlow" | "saveSchedules">,
	projectId: string,
	flows: Readonly<Record<string, unknown>>,
	schedules?: readonly Schedule[],
): Promise<void> {
	for (const [name, json] of Object.entries(flows)) {
		await engine.saveFlow(projectId, name, flowSchema.parse(migrateFlow(json)));
	}
	if (schedules !== undefined) {
		await engine.saveSchedules(projectId, schedules);
	}
}

/**
 * Writes the Clone's `.nightshift/` folder as Night Shift kept it before
 * flows were its own data: these flows by name, as they are (an older
 * version stays so), and `schedules`. The import on upgrade brings them
 * into the flow document when the project is added.
 */
export async function seedFlowFolder(
	repoPath: string,
	flows: Readonly<Record<string, unknown>>,
	schedules?: readonly Schedule[],
): Promise<void> {
	const root = join(repoPath, ".nightshift");
	await mkdir(join(root, "flows"), { recursive: true });
	for (const [name, flow] of Object.entries(flows)) {
		await writeFile(join(root, "flows", `${name}.json`), JSON.stringify(flow));
	}
	if (schedules !== undefined) {
		await writeFile(
			join(root, "schedules.json"),
			`${JSON.stringify({ version: 1, schedules }, null, "\t")}\n`,
		);
	}
}
