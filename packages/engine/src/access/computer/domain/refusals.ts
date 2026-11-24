import { Refusal } from "@nightshift/refusal";

/** What a person reads for something of this computer that is not theirs. The API says the same (`ownerOnly`). */
export const NOT_COMPUTER_OWNER_WORDS =
	"Only the owner of this computer can see or change this.";

/** The Person does not own this computer. */
export class NotComputerOwner extends Refusal {
	constructor() {
		super("forbidden", NOT_COMPUTER_OWNER_WORDS);
		this.name = "NotComputerOwner";
	}
}
