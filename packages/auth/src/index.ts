// The API of `@nightshift/auth`: the Better Auth instance (`auth.ts`, the
// composition root of the package) and the verticals' barrels.

export {
	type AccessRefusal,
	authEndpointAccess,
	type DocumentSpace,
	documentAccess,
	type RequestAccess,
	ROLE_REFUSAL,
	requestAccess,
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
	OPEN_HOST,
	TWO_FACTOR_REQUIRED,
} from "./host-access";
export { createLocalSession, type LocalSession } from "./local-session";
export { endSession, hasLogin, liveSessionIds, setLogin } from "./login";
export {
	approvePairing,
	denyPairing,
	normalizeUserCode,
	type PairingPlugin,
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
