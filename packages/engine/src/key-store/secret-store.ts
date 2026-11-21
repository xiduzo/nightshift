import { join } from "node:path";
import { type KeyStoreKind, type ValueStore, valueStore } from "./keychain";

const SECRETS_SERVICE = "nightshift";

/**
 * The secrets saved for this computer on the Secrets page: in the keychain
 * where it works, else in `<data dir>/secrets`, one file per secret,
 * readable by this user only. `prefer: "file"` skips the keychain.
 */
export function secretStore(options: {
	dataDir: string;
	prefer?: KeyStoreKind;
}): Promise<ValueStore> {
	return valueStore({
		service: SECRETS_SERVICE,
		dir: join(options.dataDir, "secrets"),
		prefer: options.prefer,
	});
}
