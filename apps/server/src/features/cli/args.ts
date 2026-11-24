import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** How a command reads its arguments, and how it refuses them. */

/**
 * The arguments do not make a command. The person sees the message and the
 * usage, or the usage alone.
 */
export class BadArguments extends Error {}

/** What each argument sets. */
export type ArgReader = {
	/** The options without a value. */
	flags?: Record<string, () => void>;
	/** The options that take the next argument. Undefined: there is no next one. */
	values?: Record<string, (value: string | undefined, flag: string) => void>;
	/** Any other argument. Left out: it is refused. */
	other?: (arg: string) => void;
};

/** Hands each argument to its option, in order. */
export function readArgs(
	argv: readonly string[],
	{ flags = {}, values = {}, other }: ArgReader,
): void {
	const args = [...argv];
	while (args.length > 0) {
		const arg = args.shift() as string;
		if (Object.hasOwn(flags, arg)) flags[arg]?.();
		else if (Object.hasOwn(values, arg)) values[arg]?.(args.shift(), arg);
		else if (other) other(arg);
		else throw new BadArguments();
	}
}

type KeysOf<T, V> = {
	[K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T];

/** Sets one option to true. */
export function turnOn<T extends object>(options: T, key: KeysOf<T, boolean>) {
	return () => {
		Object.assign(options, { [key]: true });
	};
}

/** Sets one option to its value. Without a value the option stays as it is. */
export function keep<T extends object>(
	options: T,
	key: KeysOf<T, string | null>,
) {
	return (value: string | undefined) => {
		if (value !== undefined) Object.assign(options, { [key]: value });
	};
}

/** An option that must have a value. `why` names what is wrong without one. */
export function required(
	set: (value: string) => void,
	why?: (flag: string) => string,
) {
	return (value: string | undefined, flag: string) => {
		if (!value) throw new BadArguments(why?.(flag));
		set(value);
	};
}

export const needsValue = (flag: string) => `${flag} needs a value.`;

/** `--project`: a folder becomes absolute, an id or a name stays as it is. */
export function projectArgument(cwd: string, value: string): string {
	const folder = resolve(cwd, value);
	return existsSync(folder) ? folder : value;
}
