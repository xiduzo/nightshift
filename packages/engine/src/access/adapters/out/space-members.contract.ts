import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PersonActor } from "../../../contract";
import type { SpaceMembers } from "../../application/ports";

/** One adapter of `SpaceMembers` to test, over the Members of two Spaces. */
export type SpaceMembersUnderTest = {
	members: SpaceMembers;
	/** Two Spaces, with their names. */
	space: { id: string; name: string };
	otherSpace: { id: string; name: string };
	/**
	 * Makes the Person a Member of the Space with `role`: in the `member`
	 * rows of this Replica, in the Members of the Space document, or both.
	 */
	join(
		spaceId: string,
		personId: string,
		role: string,
		where?: readonly ("replica" | "document")[],
	): Promise<void>;
	close(): Promise<void>;
};

const STOP = { run: ["stop" as const] };
const ANSWER = { gate: ["resolve" as const] };

/**
 * What every adapter of `SpaceMembers` does.
 * `space-members.contract.test.ts` runs it on the in-memory adapter and on
 * the one over `@nightshift/auth`.
 */
export function spaceMembersContract(
	name: string,
	make: () => Promise<SpaceMembersUnderTest>,
): void {
	describe(`SpaceMembers contract: ${name}`, () => {
		let under: SpaceMembersUnderTest;
		let S: string;
		beforeEach(async () => {
			under = await make();
			S = under.space.id;
		});
		afterEach(async () => {
			await under.close();
		});

		const ada: PersonActor = { personId: "person-ada", door: "session" };
		const adaByCommand: PersonActor = {
			personId: "person-ada",
			door: "command",
		};

		test("a Person who is not a Member is not a member, through every door", async () => {
			await under.join(S, "person-bob", "owner");
			for (const door of ["session", "device-key", "command"] as const) {
				expect(
					await under.members.may(S, { personId: "person-ada", door }, {}),
				).toBe("not-a-member");
			}
			expect(await under.members.may(S, ada, STOP)).toBe("not-a-member");
		});

		test("a viewer may not stop a run", async () => {
			await under.join(S, "person-ada", "viewer");
			expect(await under.members.may(S, ada, STOP)).toBe("no");
		});

		test("a member may answer a Gate", async () => {
			await under.join(S, "person-ada", "member");
			expect(await under.members.may(S, ada, ANSWER)).toBe("yes");
		});

		test("a row with two roles: one that allows is enough", async () => {
			await under.join(S, "person-ada", "viewer,member");
			expect(await under.members.may(S, ada, STOP)).toBe("yes");
		});

		test("an unknown role allows nothing", async () => {
			await under.join(S, "person-ada", "guest");
			expect(await under.members.may(S, ada, STOP)).toBe("no");
		});

		test("no need allows every Member, also one of an unknown role", async () => {
			await under.join(S, "person-ada", "viewer");
			await under.join(S, "person-bob", "guest");
			expect(await under.members.may(S, ada, {})).toBe("yes");
			expect(
				await under.members.may(
					S,
					{ personId: "person-bob", door: "session" },
					{},
				),
			).toBe("yes");
		});

		test("a Member of one Space is not a member of another", async () => {
			await under.join(S, "person-ada", "owner");
			expect(await under.members.may(under.otherSpace.id, ada, {})).toBe(
				"not-a-member",
			);
		});

		test("the session and a Device key read the rows, a Command reads the Space document", async () => {
			await under.join(S, "person-ada", "viewer", ["replica"]);
			await under.join(S, "person-ada", "member", ["document"]);
			expect(await under.members.may(S, ada, STOP)).toBe("no");
			expect(
				await under.members.may(
					S,
					{ personId: "person-ada", door: "session" },
					STOP,
				),
			).toBe("no");
			expect(
				await under.members.may(
					S,
					{ personId: "person-ada", door: "device-key" },
					STOP,
				),
			).toBe("no");
			expect(await under.members.may(S, adaByCommand, STOP)).toBe("yes");
		});

		test("a Member only in the Space document is one for a Command only", async () => {
			await under.join(S, "person-ada", "member", ["document"]);
			expect(await under.members.may(S, adaByCommand, ANSWER)).toBe("yes");
			expect(await under.members.may(S, ada, ANSWER)).toBe("not-a-member");
		});
	});
}
