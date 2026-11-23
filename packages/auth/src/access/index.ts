// Who a caller is and what it may do: the access of one request (its
// session, its Space, the Host rules), and who may open which synced
// document. It composes the other verticals, and none of them imports it.
export {
	type AccessRefusal,
	ROLE_REFUSAL,
	RoleRefusal,
	spaceAccess,
} from "./domain/space-access";
export type {
	DocumentOf,
	SyncAccess,
	SyncAuthorize,
	SyncDeviceKey,
	SyncGrant,
} from "./domain/sync-access";
export {
	type Access,
	type RequestAccess,
	type SpaceAccess,
	type SyncSetup,
	wireAccess,
} from "./wire";
