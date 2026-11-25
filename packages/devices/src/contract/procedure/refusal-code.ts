import { NotOnThisComputer } from "@nightshift/engine";
import { Refusal, type RefusalKind } from "@nightshift/refusal";
import { z } from "zod";

/**
 * A refusal that the other side finds by its class, not by its words. A
 * Host sends its code beside its kind (`refusalDataSchema`), and a placed
 * Device beside the words of a work error (`workReplySchema`). The other
 * side makes the class again (`refusalOfCode`).
 */
export const refusalCodeSchema = z.enum(["not-on-this-computer"]);

export type RefusalCode = z.infer<typeof refusalCodeSchema>;

/** The code of `error`, when the other side finds it by its class. */
export function codeOfRefusal(error: unknown): RefusalCode | undefined {
	return error instanceof NotOnThisComputer
		? "not-on-this-computer"
		: undefined;
}

/** The refusal of the other side: the class of its code, else its kind and words. */
export function refusalOfCode(
	refused: { code?: RefusalCode; kind: RefusalKind; message: string },
	options?: ErrorOptions,
): Refusal {
	return refused.code === "not-on-this-computer"
		? new NotOnThisComputer(options)
		: new Refusal(refused.kind, refused.message, options);
}
