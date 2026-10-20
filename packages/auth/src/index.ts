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
	type PairingPlugin,
	PEER_ADDRESS_HEADER,
	type Session,
	TRUSTED_BROWSER_DAYS,
} from "./auth";
export {
	bearerDeviceKey,
	createDeviceKeys,
	type DeviceKeyAccess,
	type DeviceKeyPermission,
	isDeviceKey,
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
export { hasLogin, setLogin } from "./login";
// InvitationView, PendingInvitation and SpaceMember are in the API's
// router type: its declaration must be able to name them.
export {
	type InvitationView,
	invitationView,
	type MemberChange,
	membersOf,
	type PendingInvitation,
	type SpaceMember,
} from "./members";
export {
	approvePairing,
	denyPairing,
	normalizeUserCode,
	redeemPairing,
	reviewPairing,
	startPairing,
} from "./pairing";
export { type RequestAccess, requestAccess } from "./request";
export {
	localPerson,
	personalSpaceId,
	roleIn,
	type Space,
	spacesOf,
} from "./spaces";
