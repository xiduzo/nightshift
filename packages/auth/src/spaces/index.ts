// InvitationView, PendingInvitation and SpaceMember are in the API's
// router type: its declaration must be able to name them.

export type { Space } from "./application/list-spaces";
export {
	HOST_ADMIN,
	type InvitationView,
	type MemberChange,
	type PendingInvitation,
	type SpaceMember,
} from "./members";
export { type OwnedDevice, personalSpaceName } from "./personal";
export {
	type Permissions,
	ROLE_PERMISSIONS,
	type Role,
	roleAllows,
	statements,
} from "./roles";
export { type Spaces, wireSpaces } from "./wire";
