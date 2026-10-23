/// <reference types="bun" />
import { expect, test } from "bun:test";

import { inboxTabLabel } from "./tabs";

test("the Inbox tab says how many Gates wait for you", () => {
	expect(inboxTabLabel(0)).toBe("Inbox");
	expect(inboxTabLabel(1)).toBe("Inbox, 1 Gate waits for you");
	expect(inboxTabLabel(3)).toBe("Inbox, 3 Gates wait for you");
});
