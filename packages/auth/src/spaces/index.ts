// InvitationView, PendingInvitation and SpaceMember are in the API's
// router type: its declaration must be able to name them.
export {
	addMembership,
	HOST_ADMIN,
	hasHostAdmin,
	type InvitationView,
	invitationView,
	isHostAdmin,
	type MemberChange,
	membershipOf,
	membersOf,
	type PendingInvitation,
	removeMemberships,
	type SpaceMember,
	setMembershipRole,
	signUpRefusal,
	spaceRoster,
} from "./members";
export { personContact, personNames } from "./people";
export {
	ac,
	type Permissions,
	type Role,
	roleAllows,
	roles,
} from "./roles";
export {
	activeSpaceId,
	adoptPersonalSpaceBatch,
	ensurePersonalSpace,
	localPerson,
	mirrorHostSpace,
	personalSpaceId,
	personalSpaceIdBySlug,
	roleIn,
	type Space,
	spaceExists,
	spaceIds,
	spacesOf,
} from "./spaces";
