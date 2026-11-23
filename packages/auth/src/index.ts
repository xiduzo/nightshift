// The API of `@nightshift/auth`: the Better Auth instance (`auth.ts`, the
// composition root of the package) and the verticals' barrels.

export {
	type Access,
	type AccessRefusal,
	authEndpointAllowed,
	type DocumentOf,
	type HostAccess,
	type HostPolicy,
	hostPolicyFromEnv,
	type LocalSession,
	type Login,
	type LoginInput,
	type RequestAccess,
	ROLE_REFUSAL,
	RoleRefusal,
	type SpaceAccess,
	type SyncAccess,
	type SyncAuthorize,
	type SyncDeviceKey,
	type SyncGrant,
	type SyncSetup,
	spaceAccess,
	TRUSTED_BROWSER_DAYS,
	wireAccess,
	wireLocalSession,
	wireLogin,
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
	type DeviceKeyAccess,
	type DeviceKeyPermission,
	type DeviceKeys,
	type PairingAnswer,
	type PairingCode,
	type PairingReview,
	wireDeviceKeys,
	wirePairing,
} from "./devices";
// InvitationView, PendingInvitation and SpaceMember are in the API's
// router type: its declaration must be able to name them.
export {
	type InvitationView,
	type MemberChange,
	type OwnedDevice,
	type PendingInvitation,
	type Permissions,
	personalSpaceName,
	type Role,
	roleAllows,
	type Space,
	type SpaceMember,
	type Spaces,
	wireSpaces,
} from "./spaces";
