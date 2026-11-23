import type { Actor, OwnDevice } from "@nightshift/engine";
import {
	deviceIdOf,
	type FlowNode,
	type FlowSources,
	type Schedule,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { type DeviceOffer, offerRefusal, spaceOffers } from "../domain/offers";

export type CheckScheduleOffersPorts = {
	documents: {
		open(spaceId: string): Promise<{ offers: { values(): Iterable<unknown> } }>;
	};
	devicesFor(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<OwnDevice[]>;
	/** The id of the Replica that keeps the Space: its Host, or this computer. */
	keeper(spaceId: string): Promise<string>;
	/** This computer's Offers into the Space that are in force. */
	offersHere(spaceId: string): Promise<DeviceOffer[]>;
	/** Whether the Person's role in the Space lets them use Offers. */
	mayUseOffers?: (spaceId: string, personId: string) => Promise<boolean>;
	personInSpace(spaceId: string, personId: string): Promise<string>;
	flowsForRun(
		sources: FlowSources,
		input: { projectId: string; flowName: string },
	): {
		flow: { nodes: FlowNode[] };
		calledFlows: Record<string, { nodes: FlowNode[] }>;
	};
};

/**
 * A schedule's runs run on the Replica that keeps the Space. When that
 * Replica is another Person's, a schedule starts the saver's runs there,
 * through its Offers: it gets the saver as its `person`, and is refused
 * unless the Offers in the Space cover what its flow runs there now.
 * The saver's own Host names no Person.
 */
export const checkScheduleOffers =
	(ports: CheckScheduleOffersPorts) =>
	async (
		project: { id: string; flows(): Promise<FlowSources> },
		spaceId: string,
		actor: Actor,
		schedules: readonly Schedule[],
	): Promise<Schedule[]> => {
		const person = "personId" in actor ? actor.personId : null;
		if (person === null || schedules.length === 0) return [...schedules];
		const personId = await ports.personInSpace(spaceId, person);
		const devices = await ports.devicesFor(spaceId, personId, project.id);
		const document = await ports.documents.open(spaceId);
		const keeperId = await ports.keeper(spaceId);
		const theirs = devices.find((d) => d.deviceId === keeperId) ?? null;
		if (theirs === null) {
			// Another Person's Host that offers this Person nothing.
			throw new Refusal(
				"conflict",
				"Schedules run on the Host of this Space. Its owner offers you nothing there yet.",
			);
		}
		const out: Schedule[] = [];
		for (const schedule of schedules) {
			const { person: _old, ...rest } = schedule;
			if (theirs.offers === undefined) {
				out.push(rest);
				continue;
			}
			let nodes: FlowNode[] = [];
			try {
				// A webhook that only sends a signal starts no flow: it has no nodes.
				const flowName = schedule.flow;
				if (flowName === undefined) throw new Error("No flow.");
				const loaded = ports.flowsForRun(await project.flows(), {
					projectId: project.id,
					flowName,
				});
				nodes = [loaded.flow, ...Object.values(loaded.calledFlows)]
					.flatMap((f) => f.nodes)
					// The schedule's run starts on the Host: its nodes run there
					// unless they name another Device.
					.filter(
						(n) =>
							!("device" in n) ||
							!n.device ||
							deviceIdOf(n.device) === theirs.deviceId,
					);
			} catch {
				// A flow that does not load is the schedule's own issue.
			}
			const refusal = offerRefusal(nodes, {
				deviceName: theirs.name,
				offers: theirs.thisDevice
					? await ports.offersHere(spaceId)
					: spaceOffers(document, theirs.deviceId),
				mayUse: (await ports.mayUseOffers?.(spaceId, personId)) ?? false,
			});
			if (refusal !== null) {
				throw new Refusal(
					"conflict",
					`The schedule "${schedule.id}" runs on another person's computer. ${refusal}`,
				);
			}
			out.push({ ...rest, person: personId });
		}
		return out;
	};
