/**
 * The names the export writes outside the run records. The strings live
 * in `@nightshift/semconv`, generated from the Weaver registry. This
 * module only re-exports them. The run records (`runs/`) read the
 * registry's names there themselves.
 */

export { ATTR, SERVICE_NAME } from "@nightshift/semconv";

/** The instrumentation scope of the tracer and the meter. */
export const SCOPE_NAME = "@nightshift/telemetry";
