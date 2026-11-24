import { organization, project, run } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { inMemoryAccess } from "../../access/adapters/out/in-memory-access";
import type { RunRecord } from "../../access/application/open-run";
import {
	createRunBus,
	createRunLog,
	type EngineEventType,
	type EnginePayloads,
} from "../../log";
import {
	type DrizzleRunViewsDeps,
	drizzleRunViews,
} from "./adapters/out/drizzle-run-views";
import { inMemoryPrivatePaths } from "./adapters/out/in-memory-neighbours";

/** What the views read besides the rows and the logs. */
export type ViewNeighbours = Pick<
	DrizzleRunViewsDeps,
	"walkers" | "pendingCommands" | "stepEntries" | "ownEntries"
>;

/** One event for a run's log, as a test writes it. */
export type RunEvent<T extends EngineEventType = EngineEventType> = {
	type: T;
	payload: EnginePayloads[T];
	runId: string;
	stepId?: string | null;
};

/** Every port of the views, over a database and the run log. A run a test adds is a row of the views and of access. */
export async function viewsPorts(given: Partial<ViewNeighbours> = {}) {
	const access = inMemoryAccess();
	const db = await migratedDb();
	const deviceId = "this-computer";
	const bus = createRunBus();
	const log = createRunLog(db, { walkerId: deviceId, dataDir: "/nowhere" });
	const views = drizzleRunViews({
		db,
		log,
		bus,
		deviceId,
		harnessOf: () => undefined,
		walkers: async (_spaceId, ids) =>
			new Map(
				ids.map((id) => [id, { id, name: null, thisDevice: id === deviceId }]),
			),
		pendingCommands: async () => new Map(),
		stepEntries: async function* () {},
		ownEntries: async () => [],
		...given,
	});
	return {
		views,
		append: (event: RunEvent) => log.append(event),
		paths: inMemoryPrivatePaths(),
		/** The runs and the Members that access reads. */
		access,
		openRun: access.openRun,
		openSpace: access.openSpace,
		async addRun(row: RunRecord) {
			const { spaceId, projectId } = row;
			await db
				.insert(organization)
				.values({ id: spaceId, name: "", slug: spaceId, createdAt: asDate(0) })
				.onConflictDoNothing();
			await db
				.insert(project)
				.values({ id: projectId, spaceId, name: projectId })
				.onConflictDoNothing();
			await db.insert(run).values(row);
			access.runs.add(row);
		},
	};
}
