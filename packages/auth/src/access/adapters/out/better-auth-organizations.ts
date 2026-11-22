import type { Auth } from "../../../auth";
import type { Organizations } from "../../application/ports";
import { refuse } from "../../domain/auth-refusals";

/**
 * `Organizations` over Better Auth's organization plugin. Every call goes
 * through `auth.api` with the headers of the Person who acts: the plugin's
 * hooks read who acts from that call (the `MemberChange` actor), so no
 * call may skip it. A refusal of the plugin becomes a `Refusal` in Night
 * Shift's words (`refuse`). `wireAccess` builds it.
 */
export function betterAuthOrganizations(auth: Auth): Organizations {
	return {
		async setActive(headers, spaceId) {
			await auth.api
				.setActiveOrganization({ headers, body: { organizationId: spaceId } })
				.catch(refuse);
		},
		async create(headers, space) {
			const created = await auth.api
				.createOrganization({
					headers,
					body: { name: space.name, slug: space.slug },
				})
				.catch(refuse);
			return created ? { id: created.id } : null;
		},
		async invite(headers, invitation) {
			const created = await auth.api
				.createInvitation({
					headers,
					body: {
						email: invitation.email,
						role: invitation.role,
						organizationId: invitation.spaceId,
					},
				})
				.catch(refuse);
			return { id: created.id };
		},
		async cancelInvitation(headers, invitationId) {
			await auth.api
				.cancelInvitation({ headers, body: { invitationId } })
				.catch(refuse);
		},
		async setRole(headers, change) {
			await auth.api
				.updateMemberRole({
					headers,
					body: {
						memberId: change.memberId,
						role: change.role,
						organizationId: change.spaceId,
					},
				})
				.catch(refuse);
		},
		async remove(headers, member) {
			await auth.api
				.removeMember({
					headers,
					body: {
						memberIdOrEmail: member.memberId,
						organizationId: member.spaceId,
					},
				})
				.catch(refuse);
		},
		async accept(headers, invitationId) {
			const accepted = await auth.api
				.acceptInvitation({ headers, body: { invitationId } })
				.catch(refuse);
			return accepted ? { spaceId: accepted.member.organizationId } : null;
		},
	};
}
