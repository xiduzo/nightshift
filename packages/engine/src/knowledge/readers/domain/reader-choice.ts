import {
	PAGE_READER_DEFAULTS,
	type PageReaderSetting,
} from "@nightshift/flows";

/**
 * The reader a project's setting names (ADR 39): Night Shift's own, which
 * needs no key, or a service at its address, with the key from the secret
 * the setting names.
 */

/** A secret's value by its name, from the scopes of one use, or undefined when it is not saved. */
export type ReaderSecret = (name: string) => Promise<string | undefined>;

/** A setting of a reader that is a service. */
export type ServiceSetting = Exclude<PageReaderSetting, { kind: "nightshift" }>;

/** The name of the secret a service reader takes its key from: the setting's, else the reader's default. */
export function keyNameOf(setting: ServiceSetting): string {
	return setting.secret ?? PAGE_READER_DEFAULTS[setting.kind].secret;
}

/** Where a service reader is: the setting's address, else the reader's default. */
export function addressOf(setting: ServiceSetting): string {
	return setting.address ?? PAGE_READER_DEFAULTS[setting.kind].address;
}

/**
 * The reader a setting names: `build.local` for Night Shift's own, else the
 * service's reader that `build` makes, at its address, with its key from
 * `secret` when it is saved.
 */
export async function readerOf<Reader>(
	setting: PageReaderSetting,
	secret: ReaderSecret | undefined,
	build: {
		local: Reader;
		service(
			kind: ServiceSetting["kind"],
			options: { address: string; key?: string },
		): Reader;
	},
): Promise<Reader> {
	if (setting.kind === "nightshift") return build.local;
	const key = await keyOf(setting, secret);
	return build.service(setting.kind, {
		address: addressOf(setting),
		...(key ? { key } : {}),
	});
}

/** The key of a service reader: undefined when its secret is not saved, or cannot be read. */
export async function keyOf(
	setting: ServiceSetting,
	secret: ReaderSecret | undefined,
): Promise<string | undefined> {
	return (
		(await secret?.(keyNameOf(setting)).catch(() => undefined)) || undefined
	);
}
