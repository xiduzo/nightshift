/**
 * CONVERSION, with an end: `arch/end-state` removes this file, its two
 * callers in `links.ts`, `DeviceKeyStore.naming` and the read of a key under
 * the Host's id alone (`deviceKeysOf`).
 *
 * A key under the Host's id alone is also kept under this Device's own name,
 * once the Host accepted it as this Device's. The key under the Host's id
 * stays where it is.
 */
export type KeyNaming = {
	/** Which name the key in use has. Null: there is no key. */
	nameOf(hostId: string): Promise<"own" | "host" | null>;
	/**
	 * Keeps `key` under this Device's own name too, when it is the key under
	 * the Host's id and the Device has none of its own. True: it was kept.
	 * Once per start: a later call for the same Host does nothing.
	 */
	keepOwn(hostId: string, key: string): Promise<boolean>;
};

/** Says how many of this computer's keys have which name. Counts only. */
export async function reportKeyNames(
	keys: { naming?: KeyNaming },
	hostIds: readonly string[],
): Promise<void> {
	const { naming } = keys;
	if (!naming || hostIds.length === 0) return;
	try {
		const names = await Promise.all(hostIds.map((id) => naming.nameOf(id)));
		const count = (name: "own" | "host") =>
			names.filter((found) => found === name).length;
		console.log(
			`Device keys: ${count("own")} under their own name, ${count("host")} under the Host's name alone.`,
		);
	} catch {
		// The error may name an account of the keychain: it is not printed.
		console.error("Device keys: their names were not read.");
	}
}

/** The Host accepted `key` as this Device's. A failure never reaches the link. */
export async function keepUnderOwnName(
	keys: { naming?: KeyNaming },
	hostId: string,
	key: string,
): Promise<void> {
	try {
		if (await keys.naming?.keepOwn(hostId, key)) {
			console.log("Device key: 1 kept under its own name.");
		}
	} catch {
		// The error may name an account of the keychain: it is not printed.
		console.error(
			"Device key: 1 not kept under its own name. The next start tries again.",
		);
	}
}
