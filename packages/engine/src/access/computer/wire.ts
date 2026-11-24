import { openComputer } from "./application/open-computer";
import type { ComputerOwner } from "./application/ports";

/** The check of who may act on this computer, bound to its owner. It builds no adapter of its own. */
export type ComputerAccess = {
	/** Opens this computer for an actor: its owner, or Night Shift. */
	openComputer: ReturnType<typeof openComputer>;
};

export function wireComputer(owner: ComputerOwner): ComputerAccess {
	return { openComputer: openComputer({ owner }) };
}
