import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Where this computer keeps values it must not show: the system keychain
 * (`Bun.secrets`) where it works, else a file per value in a folder only
 * this user can read. A headless computer has no keychain (no login
 * session to unlock one), so it uses the files. Device keys and the
 * secrets of the Connections page both live here.
 */

export type KeyStoreKind = "keychain" | "file";

export type ValueStore = {
	readonly kind: KeyStoreKind;
	get(name: string): Promise<string | null>;
	set(name: string, value: string): Promise<void>;
	delete(name: string): Promise<void>;
};

/** The keychain under `service`, else files in `dir`. `prefer: "file"` skips the keychain. */
export async function valueStore(options: {
	service: string;
	dir: string;
	prefer?: KeyStoreKind;
}): Promise<ValueStore> {
	return options.prefer !== "file" && (await keychainWorks(options.service))
		? keychainValues(options.service)
		: fileValues(options.dir);
}

export function keychainValues(service: string): ValueStore {
	return {
		kind: "keychain",
		get: (name) => Bun.secrets.get({ service, name }),
		set: (name, value) => Bun.secrets.set({ service, name, value }),
		delete: async (name) => {
			await Bun.secrets.delete({ service, name });
		},
	};
}

/** One file per value in `dir`: the folder 0700, each file 0600. */
export function fileValues(dir: string): ValueStore {
	const file = (name: string) => join(dir, name.replace(/[^\w.-]/g, "_"));
	return {
		kind: "file",
		async get(name) {
			try {
				return (await readFile(file(name), "utf8")).trim() || null;
			} catch {
				return null;
			}
		},
		async set(name, value) {
			await mkdir(dir, { recursive: true, mode: 0o700 });
			await chmod(dir, 0o700);
			await writeFile(file(name), value, { mode: 0o600 });
			await chmod(file(name), 0o600);
		},
		async delete(name) {
			await rm(file(name), { force: true });
		},
	};
}

async function keychainWorks(service: string): Promise<boolean> {
	try {
		await Bun.secrets.get({ service, name: "probe" });
		return true;
	} catch {
		return false;
	}
}
