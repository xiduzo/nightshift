import { member } from "@nightshift/db/schema";
import { and, eq } from "drizzle-orm";
import { createAuthSandbox } from "../../../testing/sandbox";
import { betterAuthOrganizations } from "./better-auth-organizations";
import { inMemoryOrganizations } from "./in-memory-organizations";
import { inMemorySessionReader, tokenOf } from "./in-memory-session-reader";
import { organizationsContract } from "./organizations.contract";

/**
 * The contract of `Organizations`, on both adapters. The real side runs on
 * Better Auth over a fresh database, with its hooks.
 */

organizationsContract("in memory", async () => {
	const sessions = inMemorySessionReader();
	const emails = new Map<string, string>();
	const organizations = inMemoryOrganizations({
		personOf: (headers) => {
			const token = tokenOf(headers);
			return (token && sessions.sessions.get(token)?.user.id) || null;
		},
		emailOf: (personId) => emails.get(personId) ?? "",
	});
	return {
		organizations,
		async signUp(name) {
			const personId = name.toLowerCase();
			emails.set(personId, `${personId}@example.com`);
			return { personId, headers: sessions.signIn(personId) };
		},
		memberIdOf: async (spaceId, personId) =>
			organizations.members.find(
				(m) => m.spaceId === spaceId && m.personId === personId,
			)?.id ?? null,
		close: async () => {},
	};
});

organizationsContract("over better-auth", async () => {
	const sandbox = await createAuthSandbox();
	return {
		organizations: betterAuthOrganizations(sandbox.auth),
		async signUp(name) {
			const { userId, headers } = await sandbox.signUp(name);
			return { personId: userId, headers };
		},
		async memberIdOf(spaceId, personId) {
			const [found] = await sandbox.db
				.select({ id: member.id })
				.from(member)
				.where(
					and(eq(member.organizationId, spaceId), eq(member.userId, personId)),
				);
			return found?.id ?? null;
		},
		close: async () => sandbox.cleanup(),
	};
});
