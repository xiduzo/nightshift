import type { ProfileSettings } from "@nightshift/flows";
import { knownProfiles } from "../domain/device-copy";
import type { DeviceDocuments } from "./ports";

export type ReadLastKnownProfilesPorts = {
	documents: Pick<DeviceDocuments<unknown>, "readKept" | "readStoredCopy">;
};

/**
 * The profiles of another Device as its document last said, by id, with
 * their names: from the document a Host keeps for it, else this Replica's
 * copy. What a run starts from while that Device is offline (ADR 1,
 * decision 11). Null when this Replica has neither.
 */
export const readLastKnownProfiles =
	(ports: ReadLastKnownProfilesPorts) =>
	async (request: {
		deviceId: string;
	}): Promise<Map<
		string,
		{ name: string; settings: ProfileSettings }
	> | null> => {
		const record =
			(await ports.documents.readKept(request.deviceId)) ??
			(await ports.documents.readStoredCopy(request.deviceId));
		return record ? knownProfiles(record.profiles) : null;
	};
