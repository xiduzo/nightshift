import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import type { Organizations } from "../../application/ports";

/** One adapter of `Organizations` to test. */
export type OrganizationsUnderTest = {
	organizations: Organizations;
	/** A new Person (email `<name in lower case>@example.com`), signed in: the headers of their session. */
	signUp(name: string): Promise<{ personId: string; headers: Headers }>;
	/** The id of the Person's membership of the Space, or null. */
	memberIdOf(spaceId: string, personId: string): Promise<string | null>;
	close(): Promise<void>;
};

/** What `work` refuses with: its kind and its words. */
async function refusalOf(work: Promise<unknown>) {
	const error = await work.then(
		() => null,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(Refusal);
	const { kind, message } = error as Refusal;
	return { kind, message };
}

/**
 * What every adapter of `Organizations` does.
 * `organizations.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function organizationsContract(
	name: string,
	make: () => Promise<OrganizationsUnderTest>,
): void {
	describe(`Organizations contract: ${name}`, () => {
		let under: OrganizationsUnderTest;
		let ada: { personId: string; headers: Headers };
		let bob: { personId: string; headers: Headers };
		let spaceId: string;
		beforeEach(async () => {
			under = await make();
			ada = await under.signUp("Ada");
			bob = await under.signUp("Bob");
			const made = await under.organizations.create(ada.headers, {
				name: "Platform",
				slug: "platform-1a2b3c4d",
			});
			spaceId = made?.id ?? "";
		});
		afterEach(async () => {
			await under.close();
		});

		test("the maker of a Space is its owner, and only a member makes it active", async () => {
			expect(spaceId).not.toBe("");
			expect(await under.memberIdOf(spaceId, ada.personId)).not.toBeNull();
			await under.organizations.setActive(ada.headers, spaceId);
			expect(
				await refusalOf(under.organizations.setActive(bob.headers, spaceId)),
			).toMatchObject({ kind: "forbidden" });
		});

		test("an invitation of that email lets its Person join, once", async () => {
			const invitation = await under.organizations.invite(ada.headers, {
				email: "bob@example.com",
				role: "viewer",
				spaceId,
			});
			expect(
				await refusalOf(
					under.organizations.invite(ada.headers, {
						email: "bob@example.com",
						role: "member",
						spaceId,
					}),
				),
			).toEqual({
				kind: "conflict",
				message: "This person has an invitation to this Space already.",
			});
			expect(
				await under.organizations.accept(bob.headers, invitation.id),
			).toEqual({ spaceId });
			expect(await under.memberIdOf(spaceId, bob.personId)).not.toBeNull();
			expect(
				await refusalOf(
					under.organizations.invite(ada.headers, {
						email: "bob@example.com",
						role: "member",
						spaceId,
					}),
				),
			).toEqual({
				kind: "conflict",
				message: "This person is a member of this Space already.",
			});
		});

		test("an invitation that is gone, or of another email, is refused", async () => {
			expect(
				await refusalOf(under.organizations.accept(bob.headers, "no-such-id")),
			).toEqual({
				kind: "not-found",
				message: "This invitation does not exist anymore. Ask for a new one.",
			});
			const invitation = await under.organizations.invite(ada.headers, {
				email: "carol@example.com",
				role: "member",
				spaceId,
			});
			expect(
				await refusalOf(under.organizations.accept(bob.headers, invitation.id)),
			).toEqual({
				kind: "forbidden",
				message:
					"This invitation is for another email. Sign in with the email that got it.",
			});
			await under.organizations.cancelInvitation(ada.headers, invitation.id);
			const again = await under.organizations.invite(ada.headers, {
				email: "carol@example.com",
				role: "member",
				spaceId,
			});
			expect(again.id).not.toBe(invitation.id);
		});

		test("the owner changes a Member's role and removes them; a viewer may not invite", async () => {
			const invitation = await under.organizations.invite(ada.headers, {
				email: "bob@example.com",
				role: "viewer",
				spaceId,
			});
			await under.organizations.accept(bob.headers, invitation.id);
			const memberId = (await under.memberIdOf(spaceId, bob.personId)) ?? "";
			expect(
				await refusalOf(
					under.organizations.invite(bob.headers, {
						email: "carol@example.com",
						role: "member",
						spaceId,
					}),
				),
			).toEqual({
				kind: "forbidden",
				message: "Your role in this Space does not allow this.",
			});
			await under.organizations.setRole(ada.headers, {
				memberId,
				role: "admin",
				spaceId,
			});
			await under.organizations.remove(ada.headers, { memberId, spaceId });
			expect(await under.memberIdOf(spaceId, bob.personId)).toBeNull();
			expect(
				await refusalOf(
					under.organizations.remove(ada.headers, { memberId, spaceId }),
				),
			).toEqual({
				kind: "not-found",
				message: "This person is not a member of this Space anymore.",
			});
		});
	});
}
