import { USAGE_EVENT, usageEventSchema } from "@nightshift/semconv";

/**
 * Checks one usage event against the schema the registry generated.
 * An event that does not parse is not stored and not sent. The check
 * is the allowlist, and a broken schema fails at startup.
 */
export function parseUsageEvent(event: { name: string }): unknown {
	if (!(event.name in usageEventSchema)) {
		throw new Error("Unknown usage event.");
	}
	const schema = usageEventSchema[event.name as keyof typeof usageEventSchema];
	return schema.parse(event);
}

/** A valid event, so `createTelemetry` can prove the schema loads. */
export function sampleUsageEvent(): { name: string } {
	return { name: USAGE_EVENT.scheduleFired };
}
