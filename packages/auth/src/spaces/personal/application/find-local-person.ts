import { LOCAL_EMAIL, type OwnedDevice } from "../domain/personal-space";
import type { LocalPersonStore } from "./ports";

export type FindLocalPersonPorts = {
	localPersonStore: LocalPersonStore;
	/** Makes the Person the Host admin when the Host has none (`claimHostAdmin` of members). */
	claimHostAdmin: (request: { personId: string }) => Promise<void>;
	/** The Person's personal Space, made when there is none (`ensurePersonalSpace`). */
	ensurePersonalSpace: (request: { personId: string }) => Promise<string>;
	/** A new id for a new Person. */
	newId: () => string;
	/** The name of this computer's account, or "You". */
	accountName: () => string;
};

/** This computer's Device: whom it names as its owner. */
export type FindLocalPerson = { self: OwnedDevice };

/**
 * The Person who owns this computer's Device: the one Night Shift signs in
 * for you on this computer. The migration that added Spaces names one. A
 * database without one gets a new Person here. A blank name becomes the
 * name of the computer's account. A new Person is the Host admin when the
 * Host has none.
 *
 * `self` is this computer's Device row, which auth does not own: the
 * Person it names, and how to name another. Without an owner there, the
 * Person is the one with the local email.
 */
export const findLocalPerson =
	(ports: FindLocalPersonPorts) =>
	async (
		request: FindLocalPerson,
	): Promise<{ userId: string; spaceId: string }> => {
		const { self } = request;
		const store = ports.localPersonStore;
		const name = ports.accountName();
		let person = self.ownerId ? await store.find(self.ownerId) : null;
		if (!person) person = await store.findByEmail(LOCAL_EMAIL);
		let userId = person?.id;
		if (!userId) {
			userId = ports.newId();
			await store.add({ id: userId, name, email: LOCAL_EMAIL, role: "user" });
			// The first Person on a Host is its admin.
			await ports.claimHostAdmin({ personId: userId });
		}
		if (self.ownerId !== userId) await self.setOwner(userId);
		if (person && person.name.trim() === "") await store.rename(userId, name);
		return {
			userId,
			spaceId: await ports.ensurePersonalSpace({ personId: userId }),
		};
	};
