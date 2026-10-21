import type { Database } from "@nightshift/db";
import type { FlowNode, Schedule } from "@nightshift/flows";
import { readFlowSources } from "@nightshift/flows/files";
import type { Actor, OwnDevice } from "../contract";
import { flowsForRun } from "../flows";
import type { SpaceDocuments } from "../projects";
import { personOnHost } from "./exchange/host-spaces";
import { type DeviceOffer, offerRefusal, spaceOffers } from "./offers";

/**
 * A schedule that fires on another Person's Device starts the saver's
 * runs there, through that Device's Offers: each such schedule gets the
 * saver as its `person`, and is refused unless the Offers in the Space
 * cover what its flow runs on that Device now. A schedule on one of the
 * saver's own Devices names no Person.
 */
export function createScheduleOffers(deps: {
	db: Database;
	documents: SpaceDocuments;
	/** The Devices a Person may place a run of the project on (`Placement.devicesFor`). */
	devicesFor(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<OwnDevice[]>;
	/** This computer's Offers into the Space that are in force. */
	offersHere(spaceId: string): Promise<DeviceOffer[]>;
	/** Whether the Person's role in the Space lets them use Offers. */
	mayUseOffers?: (spaceId: string, personId: string) => Promise<boolean>;
}) {
	const { db } = deps;
	return async function schedulesWithOffers(
		project: { id: string; repoPath: string },
		spaceId: string,
		actor: Actor | undefined,
		schedules: readonly Schedule[],
	): Promise<Schedule[]> {
		if (!actor || !schedules.some((s) => s.device !== undefined)) {
			return [...schedules];
		}
		const personId = (await personOnHost(db, spaceId)) ?? actor.personId;
		const devices = await deps.devicesFor(spaceId, personId, project.id);
		const document = await deps.documents.open(spaceId);
		const out: Schedule[] = [];
		for (const schedule of schedules) {
			const { person: _old, ...rest } = schedule;
			const named = devices.filter((d) => d.name === schedule.device);
			const own = named.find((d) => d.offers === undefined);
			const theirs = named.find((d) => d.offers !== undefined);
			if (schedule.device === undefined || own || !theirs) {
				out.push(rest);
				continue;
			}
			let nodes: FlowNode[] = [];
			try {
				const loaded = flowsForRun(await readFlowSources(project.repoPath), {
					projectId: project.id,
					flowName: schedule.flow,
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
				throw new Error(
					`The schedule "${schedule.id}" fires on another person's device. ${refusal}`,
				);
			}
			out.push({ ...rest, person: personId });
		}
		return out;
	};
}
