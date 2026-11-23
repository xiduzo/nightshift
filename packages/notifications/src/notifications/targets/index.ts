/** The push targets of each Person: browsers, phones and desktop apps. `wireTargets` binds the use cases to their ports. */

export {
	type PushTargetView,
	pushKindSchema,
	type RegisterTarget,
	registerScreenSchema,
} from "./domain/push-targets";
export { wireTargets } from "./wire";
