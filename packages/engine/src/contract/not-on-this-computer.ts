import { Refusal } from "@nightshift/refusal";

/**
 * A call that needs the project's folder on this computer, for a project
 * without one here. A feature finds it by its class. A Host or a placed
 * Device sends it with its code, and `@nightshift/devices` makes the class
 * again on this side.
 */
export class NotOnThisComputer extends Refusal {
	constructor(options?: ErrorOptions) {
		super(
			"conflict",
			"This project is not on this computer. Add its folder here to use it.",
			options,
		);
		this.name = "NotOnThisComputer";
	}
}
