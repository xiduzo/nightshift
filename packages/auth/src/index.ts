// The API of `@nightshift/auth`: the Better Auth instance (`auth.ts`, the
// composition root of the package), the verticals' barrels, and the access
// functions that wire their slice per call (`wire-access.ts`).

export {
	type AccessRefusal,
	type DocumentOf,
	type RequestAccess,
	ROLE_REFUSAL,
	RoleRefusal,
	type SpaceAccess,
	type SyncAccess,
	type SyncAuthorize,
	type SyncDeviceKey,
	type SyncGrant,
	spaceAccess,
} from "./access";
export {
	type Auth,
	type AuthConfig,
	type AuthOptions,
	createAuth,
	PEER_ADDRESS_HEADER,
	type Session,
} from "./auth";
export {
	bearerDeviceKey,
	createDeviceKeys,
	type DeviceKeyAccess,
	type DeviceKeyPermission,
} from "./device-keys";
export {
	authEndpointAllowed,
	type HostAccess,
	type HostPolicy,
	hostPolicyFromEnv,
} from "./host-access";
export type { LocalSession } from "./local-session";
export {
	approvePairing,
	denyPairing,
	normalizeUserCode,
	redeemPairing,
	reviewPairing,
	startPairing,
} from "./pairing";
// InvitationView, PendingInvitation and SpaceMember are in the API's
// router type: its declaration must be able to name them.
export {
	addMembership,
	adoptPersonalSpaceBatch,
	type InvitationView,
	invitationView,
	isHostAdmin,
	localPerson,
	type MemberChange,
	membershipOf,
	membersOf,
	mirrorHostSpace,
	type PendingInvitation,
	type Permissions,
	personalSpaceId,
	personalSpaceIdBySlug,
	personalSpaceName,
	personContact,
	personNames,
	type Role,
	removeMemberships,
	roleAllows,
	roleIn,
	type Space,
	type SpaceMember,
	setMembershipRole,
	spaceExists,
	spaceIds,
	spaceRoster,
	spacesOf,
	splitPersonalSpaceBatch,
} from "./spaces";
export { TRUSTED_BROWSER_DAYS } from "./two-factor";
export {
	authEndpointAccess,
	createLocalSession,
	documentAccess,
	endSession,
	hasLogin,
	liveSessionIds,
	requestAccess,
	setLogin,
} from "./wire-access";
