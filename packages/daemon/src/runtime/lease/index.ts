/** The lease of the daemon: one daemon per data folder holds it, and the health check reads it. */

export {
	checkHealth,
	HEALTH_STALE_AFTER_MS,
	type HealthCheck,
	leaseHealth,
	readHeartbeat,
} from "./health";
export { type HeldLease, holdLease } from "./hold-lease";
