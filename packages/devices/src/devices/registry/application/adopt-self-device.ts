import { NO_SELF_ROW, NO_SELF_SPACE } from "../domain/paired-device";
import type { DeviceStore, EngineDeviceRows, PersonalSpaces } from "./ports";

export type AdoptSelfDevicePorts = {
	store: Pick<DeviceStore, "self" | "adopt">;
	spaces: PersonalSpaces;
	engineRows: Pick<EngineDeviceRows, "adopt">;
};

/**
 * What the request asks for: the Device to become, and the last event
 * count its home Host has of it (0: none).
 */
export type AdoptSelfDevice = { deviceId: string; lastSeq?: number };

/**
 * This install becomes the Device its home Host knows this computer as
 * (ADR 20): the `self` row, and every row that names the id it had. The
 * running daemon still holds the old id, so it starts again to use it. A
 * Device document under the old id stays in its row: the Host's copy of the
 * adopted Device is the one that counts.
 *
 * `(walker_id, walker_seq)` is an event's identity everywhere, and a Host
 * drops an event whose identity it knows. So this install's events count
 * on from `lastSeq`, the last the Host has of that Device. A fact at that
 * count holds the place: the next event takes the number after the highest.
 * The engine's rows (`engineRows`) go in the same batch, between this
 * computer's `device` rows and its Commands.
 *
 * Night Shift asks it: the use case takes the request alone.
 */
export const adoptSelfDevice =
	(ports: AdoptSelfDevicePorts) =>
	async (request: AdoptSelfDevice): Promise<void> => {
		const { deviceId } = request;
		const lastSeq = request.lastSeq ?? 0;
		const row = await ports.store.self();
		if (!row) throw new Error(NO_SELF_ROW);
		const from = row.id;
		if (from === deviceId) return;
		const spaceId = row.ownerId ? await ports.spaces.idOf(row.ownerId) : null;
		if (lastSeq > 0 && spaceId === null) throw new Error(NO_SELF_SPACE);
		// The engine's statements: Clones, runs, steps, events and leases.
		const engine = ports.engineRows.adopt({
			from,
			to: deviceId,
			lastSeq,
			joined:
				lastSeq > 0 && spaceId !== null && row.ownerId
					? {
							type: "DeviceJoined",
							spaceId,
							payload: {
								deviceId,
								name: row.name,
								platform: row.platform,
								ownerId: row.ownerId,
								home: true,
							},
						}
					: null,
		});
		await ports.store.adopt({ row, to: deviceId, engine });
	};
