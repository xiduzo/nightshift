import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Schedule } from "@nightshift/flows";
import { writeSchedulesFile } from "@nightshift/flows/files";

/**
 * Gives a project in the Clone at `repoPath` these flows, by name, as
 * they are: an older version or JSON that is not a flow stays so. With
 * `schedules`, its schedules too. Where the file adapter of
 * `ProjectFlows` reads them.
 */
export async function seedFlows(
	repoPath: string,
	flows: Readonly<Record<string, unknown>>,
	schedules?: readonly Schedule[],
): Promise<void> {
	const dir = join(repoPath, ".nightshift", "flows");
	await mkdir(dir, { recursive: true });
	for (const [name, flow] of Object.entries(flows)) {
		await writeFile(join(dir, `${name}.json`), JSON.stringify(flow));
	}
	if (schedules !== undefined) await writeSchedulesFile(repoPath, schedules);
}
