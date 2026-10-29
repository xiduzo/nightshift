import type { Database } from "@nightshift/db";
import { type Actor, flowsForRun, type OwnDevice } from "@nightshift/engine";
import type { SpaceDocuments } from "@nightshift/engine/projects";
import type { FlowNode, FlowSources, Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { personInSpace } from "../links";
import { type DeviceOffer, offerRefusal, spaceOffers } from "./offers";

/**
 * A schedule that fires on another Person's Device starts the saver's
 * runs there, through that Device's Offers: each such schedule gets the
 * saver as its `person`, and is refused unless the Offers in the Space
 * cover what its flow runs on that Device now. A schedule on one of the
 * saver's own Devices names no Person. The Device a schedule's name picks
 * is Placement's rule (`namesFor`): a name of the saver's own Device wins.
 */
export function createScheduleOffers(deps: {
	db: Database;
	documents: SpaceDocuments;
	/**
	 * The Device a name picks among those a Person may place a run of the
	 * project on (`Placement.namesFor`): null when none has it.
	 */
	namesFor(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<(name: string) => OwnDevice | null>;
	/** This computer's Offers into the Space that are in force. */
	offersHere(spaceId: string): Promise<DeviceOffer[]>;
	/** Whether the Person's role in the Space lets them use Offers. */
	mayUseOffers?: (spaceId: string, personId: string) => Promise<boolean>;
}) {
	const { db } = deps;
	return async function schedulesWithOffers(
		project: { id: string; flows(): Promise<FlowSources> },
		spaceId: string,
		actor: Actor | undefined,
		schedules: readonly Schedule[],
	): Promise<Schedule[]> {
		if (!actor || !schedules.some((s) => s.device !== undefined)) {
			return [...schedules];
		}
		const personId = await personInSpace(db, spaceId, actor.personId);
		const named = await deps.namesFor(spaceId, personId, project.id);
		const document = await deps.documents.open(spaceId);
		const out: Schedule[] = [];
		for (const schedule of schedules) {
			const { person: _old, ...rest } = schedule;
			const theirs =
				schedule.device === undefined ? null : named(schedule.device);
			if (theirs?.offers === undefined) {
				out.push(rest);
				continue;
			}
			let nodes: FlowNode[] = [];
			try {
				// A webhook that only sends a signal starts no flow: it has no nodes.
				const flowName = schedule.flow;
				if (flowName === undefined) throw new Error("No flow.");
				const loaded = flowsForRun(await project.flows(), {
					projectId: project.id,
					flowName,
				});
				nodes = [loaded.flow, ...Object.values(loaded.calledFlows)]
					.flatMap((f) => f.nodes)
					// The schedule's run starts on that Device: its nodes run there
					// unless they name another.
					.filter(
						(n) => !("device" in n) || !n.device || n.device === theirs.name,
					);
			} catch {
				// A flow that does not load is the schedule's own issue.
			}
			const refusal = offerRefusal(nodes, {
				deviceName: theirs.name,
				offers: theirs.thisDevice
					? await deps.offersHere(spaceId)
					: spaceOffers(document, theirs.deviceId),
				mayUse: (await deps.mayUseOffers?.(spaceId, personId)) ?? false,
			});
			if (refusal !== null) {
				throw new Refusal(
					"conflict",
					`The schedule "${schedule.id}" fires on another person's device. ${refusal}`,
				);
			}
			out.push({ ...rest, person: personId });
		}
		return out;
	};
}
