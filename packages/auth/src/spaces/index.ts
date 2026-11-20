// InvitationView, PendingInvitation and SpaceMember are in the API's
// router type: its declaration must be able to name them.

export type { Space } from "./application/list-spaces";
export {
	activeSpaceId,
	addMembership,
	adoptPersonalSpaceBatch,
	ensurePersonalSpace,
	hasHostAdmin,
	invitationView,
	isHostAdmin,
	localPerson,
	membershipOf,
	membersOf,
	mirrorHostSpace,
	personalSpaceId,
	personalSpaceIdBySlug,
	personContact,
	personNames,
	removeMemberships,
	roleIn,
	setMembershipRole,
	signUpRefusal,
	spaceExists,
	spaceIds,
	spaceRoster,
	spacesOf,
	splitPersonalSpaceBatch,
} from "./facades";
export {
	HOST_ADMIN,
	type InvitationView,
	type MemberChange,
	type PendingInvitation,
	type SpaceMember,
} from "./members";
export { personalSpaceName } from "./personal";
export {
	type Permissions,
	ROLE_PERMISSIONS,
	type Role,
	roleAllows,
	statements,
} from "./roles";
