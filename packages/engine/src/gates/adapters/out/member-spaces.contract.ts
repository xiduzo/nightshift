import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MemberSpaces } from "../../application/ports";

/** One adapter of `MemberSpaces` to test, over two Spaces. */
export type MemberSpacesUnderTest = {
	spaces: MemberSpaces;
	/** Two Spaces, with their names. */
	space: { id: string; name: string };
	otherSpace: { id: string; name: string };
	/** Makes the Person a Member of the Space with `role`. */
	join(spaceId: string, personId: string, role: string): Promise<void>;
	close(): Promise<void>;
};

const ANSWER = { gate: ["resolve" as const] };

/** The Spaces in one order, so two adapters compare. */
const byId = <T extends { id: string }>(list: readonly T[]) =>
	[...list].sort((a, b) => a.id.localeCompare(b.id));

/**
 * What every adapter of `MemberSpaces` does.
 * `member-spaces.contract.test.ts` runs it on the in-memory adapter and on
 * the one over `@nightshift/auth`.
 */
export function memberSpacesContract(
	name: string,
	make: () => Promise<MemberSpacesUnderTest>,
): void {
	describe(`MemberSpaces contract: ${name}`, () => {
		let under: MemberSpacesUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("lists each Space of the Person with its name, and whether their role there allows the need", async () => {
			await under.join(under.space.id, "person-ada", "viewer");
			await under.join(under.otherSpace.id, "person-ada", "member");
			await under.join(under.space.id, "person-bob", "owner");
			expect(
				byId(await under.spaces.of({ personId: "person-ada" }, ANSWER)),
			).toEqual(
				byId([
					{ id: under.space.id, name: under.space.name, allowed: false },
					{
						id: under.otherSpace.id,
						name: under.otherSpace.name,
						allowed: true,
					},
				]),
			);
		});

		test("a Person who is a Member of no Space has none", async () => {
			await under.join(under.space.id, "person-bob", "owner");
			expect(await under.spaces.of({ personId: "person-ada" }, {})).toEqual([]);
		});

		test("{} allows every Member, also a role this version does not know. A real need does not", async () => {
			await under.join(under.space.id, "person-ada", "auditor");
			expect(await under.spaces.of({ personId: "person-ada" }, {})).toEqual([
				{ id: under.space.id, name: under.space.name, allowed: true },
			]);
			expect(await under.spaces.of({ personId: "person-ada" }, ANSWER)).toEqual(
				[{ id: under.space.id, name: under.space.name, allowed: false }],
			);
		});

		test("the door of the Person does not change their Spaces", async () => {
			await under.join(under.space.id, "person-ada", "member");
			for (const door of ["session", "device-key", "command"] as const) {
				expect(
					await under.spaces.of({ personId: "person-ada", door }, ANSWER),
				).toEqual([
					{ id: under.space.id, name: under.space.name, allowed: true },
				]);
			}
		});
	});
}
