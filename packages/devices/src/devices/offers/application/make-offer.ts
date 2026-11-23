import { Refusal } from "@nightshift/refusal";
import type { OfferCaps } from "../../../contract";
import { listOfferSpaces } from "./list-offer-spaces";
import type {
	DeviceOffers,
	HostSpaces,
	Memberships,
	Profiles,
	Registry,
	SpaceOffers,
} from "./ports";

export type MakeOfferPorts = {
	deviceOffers: DeviceOffers;
	spaceOffers: Pick<SpaceOffers, "publish">;
	memberships: Memberships;
	profiles: Profiles;
	hostSpaces: HostSpaces;
	registry: Pick<Registry, "homePersons">;
	self: { id: string; name: string };
	ownerId: string;
	now: () => number;
};

export type MakeOffer = OfferCaps & { spaceId: string; profile: string };

/**
 * Offers one of this computer's profiles to a Space, or changes the caps.
 * Publishes in the Space first, then keeps its own entry.
 */
export const makeOffer =
	(ports: MakeOfferPorts) =>
	async (input: MakeOffer, by: string): Promise<void> => {
		const profile = ports.profiles.get(input.profile);
		if (!profile) {
			throw new Refusal(
				"conflict",
				"This profile was removed. Add it under Agents first.",
			);
		}
		const agent = ports.profiles.agent(input.profile);
		if (!agent) {
			throw new Refusal(
				"invalid",
				`The profile "${profile.name}" is for Decision and Value nodes. Only an agent profile can be offered.`,
			);
		}
		const own = (await ports.memberships.spacesOf(ports.ownerId)).find(
			(s) => s.id === input.spaceId,
		);
		if (own?.personal) {
			throw new Refusal(
				"invalid",
				"Nobody else is in your personal Space. Offer the profile to a shared Space.",
			);
		}
		if (own && !ports.memberships.roleAllows(own.role, { offer: ["make"] })) {
			throw new Refusal(
				"forbidden",
				"Your role in that Space does not let you offer profiles.",
			);
		}
		if (
			!own &&
			!(await listOfferSpaces(ports)()).some((s) => s.id === input.spaceId)
		) {
			throw new Refusal("not-found", "That Space does not exist.");
		}
		await ports.spaceOffers.publish({
			...input,
			profileName: agent.name,
			deviceId: ports.self.id,
			deviceName: ports.self.name,
			by: await ports.memberships.personInSpace(input.spaceId, by),
		});
		await ports.deviceOffers.set({ ...input, offeredAt: ports.now() });
	};
