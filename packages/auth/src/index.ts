// The API of `@nightshift/auth`: the Better Auth instance (`auth.ts`), the
// access of one request (`request.ts`), and the verticals' barrels.

export type { Permissions, Role } from "./access";
export { roleAllows, statements } from "./access";
export {
	type Auth,
	type AuthConfig,
	type AuthOptions,
	CLIENT_IP_HEADERS,
	createAuth,
	hasPermission,
	INVITATION_DAYS,
	PEER_ADDRESS_HEADER,
	type Session,
} from "./auth";
export {
	bearerDeviceKey,
	createDeviceKeys,
	type DeviceKeyAccess,
	type DeviceKeyPermission,
	isDeviceKey,
} from "./device-keys";
export {
	documentAccess,
	type SyncAccess,
	type SyncAuthorize,
	type SyncDeviceKey,
	type SyncGrant,
} from "./document-access";
export {
	authEndpointAllowed,
	type HostAccess,
	type HostPolicy,
	hostPolicyFromEnv,
	OPEN_HOST,
	TWO_FACTOR_REQUIRED,
} from "./host-access";
export { createLocalSession, type LocalSession } from "./local-session";
export { hasLogin, setLogin } from "./login";
export {
	approvePairing,
	denyPairing,
	normalizeUserCode,
	type PairingPlugin,
	redeemPairing,
	reviewPairing,
	startPairing,
} from "./pairing";
export { type RequestAccess, requestAccess } from "./request";
// InvitationView, PendingInvitation and SpaceMember are in the API's
// router type: its declaration must be able to name them.
export {
	addMembership,
	type InvitationView,
	invitationView,
	localPerson,
	type MemberChange,
	membershipOf,
	membersOf,
	mirrorHostSpace,
	type PendingInvitation,
	personalSpaceId,
	personalSpaceIdBySlug,
	personContact,
	personNames,
	removeMemberships,
	roleIn,
	type Space,
	type SpaceMember,
	setMembershipRole,
	spaceExists,
	spaceIds,
	spaceRoster,
	spacesOf,
} from "./spaces";
export { TRUSTED_BROWSER_DAYS } from "./two-factor";
