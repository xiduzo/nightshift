import { expect, test } from "bun:test";

import { nodeLadderLabel } from "./ladders";

test("names a node after the Subflow nodes it ran in", () => {
	expect(nodeLadderLabel({ nodeId: "draft" })).toBe("draft");
	expect(nodeLadderLabel({ nodeId: "draft", via: "outer/write" })).toBe(
		"outer / write / draft",
	);
});
