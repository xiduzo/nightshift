/**
 * Every name the export writes. The strings live in `@nightshift/semconv`,
 * generated from the Weaver registry. This module only re-exports them.
 */

export {
	ATTR,
	ERROR_TYPE,
	METRIC,
	OPERATION,
	PROVIDER,
	SERVICE_NAME,
	SPAN,
	TOKEN_MODALITY,
} from "@nightshift/semconv";

/** The instrumentation scope of the tracer and the meter. */
export const SCOPE_NAME = "@nightshift/telemetry";
