import { expect, test } from "bun:test";
import { NO_STARTER } from "../domain/offered-call";
import { admitOfferedCall } from "./admit-offered-call";

test("a call with no starter is refused", async () => {
	const admission = admitOfferedCall({
		selfOwnerId: async () => "ada",
		device: { id: "self", name: "This computer" } as never,
		documents: { open: async () => ({}) } as never,
		hostOf: async () => null,
		personInSpace: async () => "ada",
		personOnHost: async () => null,
		memberRole: () => "owner",
		roleAllows: () => true,
		projects: { find: async () => null, clonePath: async () => null } as never,
		runFolders: { path: () => "/runs" },
		worktreePath: () => "/work",
		serve: async function* () {},
		remote: () => ({}) as never,
	});
	const replies = [];
	for await (const reply of admission.serve(
		{
			spaceId: "team",
			projectId: "proj",
			personId: "",
			runId: null,
			call: { kind: "flows" },
		} as never,
		{ keptHere: true },
		new AbortController().signal,
	)) {
		replies.push(reply);
	}
	expect(replies).toEqual([{ kind: "error", message: NO_STARTER }]);
});
