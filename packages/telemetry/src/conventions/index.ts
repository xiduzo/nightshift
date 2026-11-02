/** The names and ids the export writes: attributes, spans, metrics, and the ids of a run's spans. */

export {
	innerSpanIdOf,
	laterSpanIdOf,
	runSpanIdOf,
	stepSpanIdOf,
	stepTraceparent,
	traceIdOf,
} from "./ids";
export {
	ATTR,
	ERROR_TYPE,
	METRIC,
	OPERATION,
	PROVIDER,
	SCOPE_NAME,
	SERVICE_NAME,
	SPAN,
	TOKEN_MODALITY,
} from "./names";
