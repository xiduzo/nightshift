import { Refusal } from "@nightshift/refusal";
import type { z } from "zod";

/** What a person reads when the answer of a Host does not fit the contract. */
export const ODD_HOST_ANSWER =
	"The Host gave an answer that this computer cannot read. Update Night Shift on both computers, then try again.";

/**
 * The answer of a Host that this computer keeps something of, as its schema
 * says it. A client does not check what a Host answers, so every answer
 * that a Device stores goes through here first. Throws a refusal
 * (`unavailable`) for one that does not fit: nothing of it is stored.
 */
export function hostAnswer<S extends z.ZodType>(
	schema: S,
	answer: unknown,
): z.output<S> {
	const read = schema.safeParse(answer);
	if (read.success) return read.data;
	throw new Refusal("unavailable", ODD_HOST_ANSWER, { cause: read.error });
}
