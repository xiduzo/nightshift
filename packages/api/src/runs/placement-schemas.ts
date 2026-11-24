import type { OwnDevice, Placement } from "@nightshift/engine";
import { z } from "zod";
import { exact } from "../output";
import { deviceProfileSchema } from "../settings";

/**
 * The Devices a run can run on. Each output mirrors the engine's view
 * type exactly (`exact`).
 */

/** A Device a run of the project can run on. */
export const placementSchema = exact<Placement>()(
	z.object({
		deviceId: z.string(),
		name: z.string(),
		thisDevice: z.boolean(),
		offers: z.array(z.string()).optional(),
		dev: z.boolean().optional(),
		ownerName: z.string().optional(),
		lastRun: z.boolean().optional(),
		default: z.boolean().optional(),
	}),
);

/** One of the Person's Devices, with whether it is online and has a Clone. */
export const ownDeviceSchema = exact<OwnDevice>()(
	placementSchema.omit({ lastRun: true, default: true }).extend({
		online: z.boolean(),
		hasClone: z.boolean(),
		profiles: z.array(deviceProfileSchema).optional(),
	}),
);
