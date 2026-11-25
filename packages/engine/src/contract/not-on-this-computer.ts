import { Refusal } from "@nightshift/refusal";

/**
 * A call that needs the project's folder on this computer, for a project
 * without one here. It is found by its class, never by its words. Over a
 * Link only its words arrive.
 */
export class NotOnThisComputer extends Refusal {
	constructor() {
		super(
			"conflict",
			"This project is not on this computer. Add its folder here to use it.",
		);
		this.name = "NotOnThisComputer";
	}
}
