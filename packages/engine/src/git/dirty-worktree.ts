import { Refusal } from "@nightshift/refusal";

export class DirtyWorktreeError extends Refusal {
	constructor(message: string) {
		// Words for the person: the step that fails shows them as they are.
		super("conflict", message);
		this.name = "DirtyWorktreeError";
	}
}
