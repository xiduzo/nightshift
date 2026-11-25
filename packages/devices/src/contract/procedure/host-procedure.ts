import type { DeviceKeyPermission } from "@nightshift/auth";
import type { RefusalKind } from "@nightshift/refusal";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { versionRefusalSchema } from "../version";
import { exact } from "./described";

/**
 * What every procedure of the Host's contract starts from: its refusals,
 * the Device key permission it asks for, and the fields that name a Device.
 */

/** What a procedure asks of its caller. `key`: the permission its Device key needs. None: a joining Device, before it has a key. */
export type HostProcedureMeta = { key?: DeviceKeyPermission };

/**
 * The refusal of a Host that is not one now: "Be a Host" is off. Not an
 * UNAUTHORIZED: the Device keeps its key and tries again later.
 */
export const NOT_A_HOST =
	"This computer does not accept devices. Turn on Be a Host on its Devices page.";

/** Ids that become Device ids on the Host. */
export const deviceId = z.string().regex(/^[\w-]{1,64}$/);

/**
 * The kind of a refusal a Host sends as a BAD_REQUEST (`Refusal.kind`).
 * A call that does not fit its input schema has none: the Device reads it
 * as `invalid`.
 */
export const refusalDataSchema = exact<{ kind: RefusalKind }>()(
	z.object({
		kind: z.enum([
			"invalid",
			"signed-out",
			"forbidden",
			"not-found",
			"conflict",
			"unavailable",
		]),
	}),
);

/**
 * The Host that refuses, beside a refusal of the Device key, or of a role
 * that a keyed call checks (`Caller.may`). A Host says it only to a call
 * that asks for that Host by its id (`HOST_HEADER`).
 */
export const keyRefusalSchema = z.object({ hostId: deviceId });

/**
 * How a Host refuses a call. UNAUTHORIZED: the Device has no access here
 * (pair it again). FORBIDDEN: it may not do this. CONFLICT: not yet, try
 * again later. BAD_REQUEST: a refusal written for people, with its kind
 * (`refusalDataSchema`). HOST_UNREACHABLE: the Host of a Space this Host
 * does not keep cannot be reached now, or this Host has another version
 * than the Device (`versionRefusalSchema`, ADR 45). A FORBIDDEN or an
 * UNAUTHORIZED never means the version. One that names the link's own Host
 * (`keyRefusalSchema`), to a hello or a heartbeat, ends the link for good.
 */
export const procedure = oc.$meta<HostProcedureMeta>({}).errors({
	UNAUTHORIZED: { status: 401, data: keyRefusalSchema.optional() },
	FORBIDDEN: { status: 403, data: keyRefusalSchema.optional() },
	CONFLICT: { status: 409 },
	BAD_REQUEST: { status: 400, data: refusalDataSchema.optional() },
	HOST_UNREACHABLE: { status: 503, data: versionRefusalSchema.optional() },
});
/** A paired Device's link and the exchange of run history. */
export const sync = procedure.meta({ key: "sync" });
/** The archive and live transcripts. */
export const archive = procedure.meta({ key: "archive" });
/** The work relay. */
export const relay = procedure.meta({ key: "relay" });

/** A SHA-256 in hex: never the hardware id itself (ADR 20). */
export const machineFingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const deviceName = z.string().trim().min(1).max(64);
