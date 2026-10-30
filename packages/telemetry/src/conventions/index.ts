/** The names and ids the export writes: attributes, spans, metrics, and the ids of a run's spans. */

export {
	innerSpanIdOf,
	laterSpanIdOf,
	runSpanIdOf,
	stepSpanIdOf,
	stepTraceparent,
	traceIdOf,
} from "./ids";
export { ATTR, METRIC, OPERATION, SCOPE_NAME, SERVICE_NAME } from "./names";
