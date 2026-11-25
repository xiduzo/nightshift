import { inspect, isDeepStrictEqual } from "node:util";
import { SECRET_MASK, type SecretMask } from "./secret-mask";

/** The fields of an error that its class may hold. */
const WORDS = ["message", "stack", "name", "cause"];

/**
 * What a stream threw, with the secret values in it as `•••`: the words,
 * the cause, the errors and the own fields of an error. It stays the same
 * error. One that cannot change becomes a new one of its class, else a
 * plain error with the hidden words. Never throws.
 */
export function redactError(error: unknown, mask: SecretMask): unknown {
	try {
		const hidden = hide(error, mask, new Set());
		return holds(hidden, mask, new Set()) ? plainError(error, mask) : hidden;
	} catch {
		return plainError(error, mask);
	}
}

function hide(error: unknown, mask: SecretMask, seen: Set<unknown>): unknown {
	if (typeof error === "string") return mask.text(error);
	if (typeof error !== "object" || error === null || seen.has(error)) {
		return error;
	}
	seen.add(error);
	const inside = (value: unknown) => hide(value, mask, seen);
	if (Array.isArray(error)) return error.map(inside);
	if (error instanceof Error) return hiddenError(error, mask, inside);
	if (isPlain(error)) {
		return Object.fromEntries(
			Object.entries(error).map(([key, field]) => [
				mask.text(key),
				inside(field),
			]),
		);
	}
	// Another class (a Response, a Map, a Buffer) stays, or goes as a whole.
	const words = ArrayBuffer.isView(error)
		? Buffer.from(error.buffer, error.byteOffset, error.byteLength).toString()
		: inspect(
				[
					error,
					Symbol.iterator in error ? [...(error as Iterable<unknown>)] : [],
				],
				{
					depth: 8,
					maxArrayLength: null,
					maxStringLength: null,
				},
			);
	return mask.text(words) === words ? error : SECRET_MASK;
}

function hiddenError(
	error: Error,
	mask: SecretMask,
	inside: (value: unknown) => unknown,
): Error {
	const fields = new Map<string | symbol, unknown>();
	let changed = false;
	for (const name of new Set([...Reflect.ownKeys(error), ...WORDS])) {
		if (!Reflect.has(error, name)) continue;
		let was: unknown;
		try {
			was = Reflect.get(error, name);
		} catch {
			// A field that cannot be read holds nothing that can be shown.
			continue;
		}
		const now = inside(was);
		const other = !isDeepStrictEqual(now, was);
		changed ||= other;
		if (other || Object.hasOwn(error, name)) fields.set(name, now);
		if (
			other &&
			!Reflect.defineProperty(error, name, { value: now, configurable: true })
		) {
			fields.set(CANNOT, true);
		}
	}
	if (!changed || !fields.has(CANNOT)) return error;
	fields.delete(CANNOT);
	return copyOf(error, fields) ?? plainError(error, mask);
}

/** Whether a value is still in it, as when two frozen errors are the cause of each other. */
function holds(error: unknown, mask: SecretMask, seen: Set<unknown>): boolean {
	if (typeof error === "string") return mask.text(error) !== error;
	if (typeof error !== "object" || error === null || seen.has(error)) {
		return false;
	}
	seen.add(error);
	if (!isPlain(error) && !Array.isArray(error) && !(error instanceof Error)) {
		return false;
	}
	return [...new Set([...Reflect.ownKeys(error), ...WORDS])].some((name) => {
		try {
			return holds(Reflect.get(error, name), mask, seen);
		} catch {
			return false;
		}
	});
}

function isPlain(value: object): boolean {
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/** Marks an error with a field that cannot change. */
const CANNOT = Symbol("cannot");

/** A new error of the same class with these fields; nothing when it does not work as one. */
function copyOf(
	error: Error,
	fields: ReadonlyMap<string | symbol, unknown>,
): Error | null {
	try {
		const copy: Error =
			error instanceof DOMException
				? new DOMException(
						String(fields.get("message") ?? ""),
						String(fields.get("name") ?? error.name),
					)
				: Object.setPrototypeOf(new Error(), Object.getPrototypeOf(error));
		for (const [name, field] of fields) {
			const value = field === error ? copy : field;
			Object.defineProperty(copy, name, {
				value,
				enumerable: Object.prototype.propertyIsEnumerable.call(error, name),
				configurable: true,
				writable: true,
			});
		}
		// Its words must read without a throw.
		return typeof copy.name === "string" && typeof `${copy}` === "string"
			? copy
			: null;
	} catch {
		return null;
	}
}

/** An error of no class, with the hidden words and the name: an abort stays an abort. */
function plainError(error: unknown, mask: SecretMask): Error {
	const word = (name: string) => {
		try {
			const value = Reflect.get(Object(error), name);
			return typeof value === "string" ? mask.text(value) : null;
		} catch {
			return null;
		}
	};
	const plain = new Error(word("message") ?? SECRET_MASK);
	plain.name = word("name") ?? plain.name;
	return plain;
}
