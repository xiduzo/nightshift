import { Refusal } from "@nightshift/refusal";

/**
 * A call that needs the project's folder on this computer, for a project
 * without one here. A feature finds it by its class. A Link brings only a
 * refusal's kind and words: the adapter that calls the Host makes it again
 * (`relayHostStarts`).
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
