/** What a node's profile names: the Device that runs the step, the profile of that Device with its backups, the decider and the address of its model. */

export {
	addressRoot,
	checkModelAddress,
	type DeciderName,
	deciderAddress,
	deciderMeasuresProbability,
	deciderNameSchema,
	type ModelAddress,
	modelAddressPlain,
	modelAddressSchema,
	requestHeadersSchema,
} from "./decider";
export {
	checkNodeProfile,
	type DeviceRef,
	deviceIdOf,
	deviceIdSchema,
	isProfileRef,
	legacyDeviceName,
	type NodeProfile,
	nodeProfilePlain,
	nodeProfileSchema,
	type ProfileRef,
	placed,
	placedPlain,
	profileFallbacksSchema,
	sameProfileRef,
} from "./device";
