import {
	type Actor,
	NIGHT_SHIFT,
	type PersonActor,
} from "../../../../contract";
import { openComputer } from "../../application/open-computer";
import type { ComputerOwner } from "../../application/ports";
import { NotComputerOwner } from "../../domain/refusals";

/** The owner of the computer of `inMemoryComputer`. */
export const COMPUTER_OWNER: PersonActor = {
	personId: "the-owner-of-this-computer",
	door: "session",
};

/**
 * This computer in memory: the real `openComputer` over an owner. The
 * use-case test of every slice that asks who may act on this computer
 * takes this one.
 */
export function inMemoryComputer(
	owner: ComputerOwner = { id: () => COMPUTER_OWNER.personId },
) {
	return {
		openComputer: openComputer({ owner }),

		/**
		 * Who may act on this computer: asks `act` as its owner, as another
		 * Person and as Night Shift. A refusal of another kind says that the
		 * actor got in. `effects` reads what `act` may change: a refused ask
		 * that changed it was refused too late.
		 */
		async whoMay(
			act: (actor: PersonActor) => unknown,
			effects: () => unknown = () => null,
		) {
			const ask = async (actor: Actor) => {
				const before = JSON.stringify(effects());
				try {
					await act(actor as PersonActor);
				} catch (error) {
					if (error instanceof NotComputerOwner) {
						return JSON.stringify(effects()) === before ? "no" : "too-late";
					}
				}
				return "yes";
			};
			return {
				another: await ask({ personId: "another-person", door: "session" }),
				owner: await ask(COMPUTER_OWNER),
				nightShift: await ask(NIGHT_SHIFT),
			};
		},
	};
}

/** What `whoMay` gives when only the owner of this computer, and Night Shift, may act. */
export const ONLY_THE_OWNER = {
	another: "no",
	owner: "yes",
	nightShift: "yes",
};
