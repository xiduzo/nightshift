/** The names of a flow: a node id, an input, a variable, a flow file, a kit, an outcome and a secret, the names Night Shift keeps for itself, and the `${NAME}` references of a text. */

export {
	calledFlowNameSchema,
	flowNameSchema,
	kitNameSchema,
	labelSchema,
	nameSchema,
	nodeIdSchema,
	reservedNames,
	reservedOutcomes,
	ruleOwnNames,
	secretNameSchema,
	templateOwnNames,
} from "./names";
export { type SecretPart, secretNamesIn, secretParts } from "./secret-refs";
