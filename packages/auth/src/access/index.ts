// Who a caller is and what it may do: the access of one request (its
// session, its Space, the Host rules), and who may open which synced
// document. It composes the other verticals, and none of them imports it.
export {
	type DocumentOf,
	documentAccess,
	type SyncAccess,
	type SyncAuthorize,
	type SyncDeviceKey,
	type SyncGrant,
} from "./document-access";
export {
	authEndpointAccess,
	type RequestAccess,
	requestAccess,
} from "./request";
export {
	type AccessRefusal,
	ROLE_REFUSAL,
	type SpaceAccess,
	spaceAccess,
} from "./space-access";
