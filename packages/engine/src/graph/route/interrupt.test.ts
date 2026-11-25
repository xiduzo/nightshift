import { expect, test } from "bun:test";

import type { RunStateValues } from "../state";
import { gateNode } from "./interrupt";

test("an answer to a Gate or an Ask that is closed says which of the two is not open", async () => {
	const closed = (what?: "question") =>
		gateNode({ id: "ask" }, {} as never, {
			...(what ? { what } : {}),
			answer: () => {
				throw new Error("Nothing is open.");
			},
		})({ pending: {} } as RunStateValues, {});
	const said = async (what?: "question") => {
		try {
			return await closed(what);
		} catch (error) {
			return (error as Error).message;
		}
	};
	expect(await said()).toBe('No Gate is open at node "ask".');
	expect(await said("question")).toBe('No question is open at node "ask".');
});
