import { Refusal } from "@nightshift/refusal";
import { now as timeNow } from "@nightshift/time";
import type { PersonalMerge as HostAnswer } from "../../../contract";
import type { Link } from "../../../links";
import type { MergeRow, MergeTarget } from "../domain/membership-rows";
import {
	type MergeHeld,
	mergeHeld,
	movedLate,
	notDoneHeld,
} from "../domain/words";
import type { MergeDeps, MergeReady } from "./merge-steps";
import type { MembershipRecord } from "./ports";

/** How long a Host that refused the Projects is not asked again: 1 hour. */
const REFUSED_FOR_MS = 60 * 60_000;

/** The steps of a merge that its late Projects take too. */
type Steps = {
	checks(started: MergeRow): Promise<MergeReady | MergeHeld>;
	ask(
		link: Link,
		from: string,
		joined: readonly string[],
		dryRun: boolean,
	): Promise<HostAnswer>;
	targetsOf(answer: HostAnswer, to: string): Record<string, MergeTarget>;
	changed(
		from: string,
		projectMap: Record<string, MergeTarget>,
	): Promise<boolean>;
	runsOf(spaceId: string): Promise<{ notDone: number }>;
};

/**
 * The Projects that a done merge of an older version left in the old Space,
 * whose row is gone: no Person reaches them there. They move to the Host
 * the person merged with, and each one's Flows page says so.
 */
export function lateProjects(
	deps: MergeDeps & { record: MembershipRecord },
	steps: Steps,
) {
	const { engine } = deps;
	const now = deps.now ?? timeNow;
	const rows = deps.record.merges;

	/** Tells the person on the Flows page of each Project that moved later than the merge. */
	async function say(row: MergeRow): Promise<void> {
		if (!row.late) return;
		const home = await deps.hostLinks.home();
		const name = home?.hostId === row.hostId ? home.name : "your home Host";
		for (const { projectId } of Object.values(row.late.projectMap)) {
			await engine.flows.note(projectId, `movedLate:${row.fromSpace}`, {
				kind: "project-moved",
				message: movedLate(name),
			});
		}
	}

	/** The old Spaces whose Projects did not move: when a try may come again. */
	const waits = new Map<string, number>();

	/**
	 * Moves the Projects a done merge left in its old Space to the Host, when
	 * the Host answers and no run of them goes on. A copy of the database
	 * first. Null: none is left, or not now.
	 */
	async function moveOf(row: MergeRow): Promise<MergeRow | null> {
		const { fromSpace: from, toSpace: to } = row;
		if (to === null || now() < (waits.get(from) ?? 0)) return null;
		if ((await engine.projects.ofSpace(from)).length === 0) return null;
		// Only an old Space that is gone, of the Personal this computer has now.
		if (await deps.personalSpaces.exists(from)) return null;
		if ((await engine.hostSpaces.keeper(from)) !== null) return null;
		if ((await deps.personalSpaces.personalId(deps.ownerId)) !== to)
			return null;
		if ((await deps.hostLinks.home())?.hostId !== row.hostId) return null;
		const checked = await steps.checks(row);
		if (checked.held !== null || checked.to !== to) return null;
		const answer = await steps
			.ask(checked.link, from, [], false)
			.catch((error: unknown) => {
				// A Host that does not answer is asked again soon.
				if (error instanceof Refusal && error.kind !== "unavailable") {
					if (!waits.has(from)) {
						console.warn(
							`[devices] Projects of ${from} stay on this computer: ${error.message}`,
						);
					}
					waits.set(from, now() + REFUSED_FOR_MS);
				}
				throw error;
			});
		if (answer.spaceId !== to) return null;
		const projectMap = steps.targetsOf(answer, to);
		const { personMap } = answer;
		try {
			const backup = await deps.databaseCopy.copy(
				deps.dataDir,
				now(),
				"late-projects",
			);
			await engine.moveProjects({
				from,
				plan: async () => {
					const { notDone } = await steps.runsOf(from);
					if (notDone > 0) throw notDoneHeld(notDone).refusal;
					if (await steps.changed(from, projectMap))
						throw mergeHeld("changed").refusal;
					return {
						projects: projectMap,
						personMap,
						renumber: true,
						empties: true,
					};
				},
				statements: () => rows.late(from, { projectMap, personMap }),
			});
			console.warn(
				`[devices] Projects that stayed on this computer moved to its home Host: ${Object.keys(projectMap).join(", ")}. The copy of the database: ${backup}`,
			);
		} catch (error) {
			// Not on and on: each try makes a copy of the database.
			waits.set(from, Number.POSITIVE_INFINITY);
			throw error;
		}
		return rows.latest();
	}

	return { say, moveOf };
}
