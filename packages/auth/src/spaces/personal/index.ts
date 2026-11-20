/**
 * Personal: a Person's personal Space, and the Person who owns this
 * computer. `wirePersonal` binds the use cases to their ports.
 */

export {
	LOCAL_EMAIL,
	type OwnedDevice,
	personalSpaceName,
	type RowBatch,
	UNOWNED,
} from "./domain/personal-space";
export { type Personal, wirePersonal } from "./wire";
