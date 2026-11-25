import { inspect } from "node:util";
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
		return holds(error, mask) ? hide(error, mask, new Map()) : error;
	} catch {
		return plainError(error, mask);
	}
}

/** `made`: what each object became, so one that is met again is the same one. */
function hide(
	value: unknown,
	mask: SecretMask,
	made: Map<object, unknown>,
): unknown {
	if (typeof value === "string") return mask.text(value);
	if (typeof value !== "object" || value === null) return value;
	if (made.has(value)) return made.get(value);
	const inside = (field: unknown) => hide(field, mask, made);
	if (Array.isArray(value)) {
		const list: unknown[] = [];
		made.set(value, list);
		for (const item of value) list.push(inside(item));
		return list;
	}
	if (isPlain(value)) {
		const object = {};
		made.set(value, object);
		for (const [key, field] of Object.entries(value)) {
			put(object, mask.text(key), inside(field), true);
		}
		return object;
	}
	if (!(value instanceof Error)) {
		return holds(value, mask) ? SECRET_MASK : value;
	}
	const error = canChange(value, mask) ? value : shellOf(value, mask);
	made.set(value, error);
	for (const [name, field] of fieldsOf(value)) {
		const hidden = holds(field, mask) ? inside(field) : field;
		if (error !== value || hidden !== field) {
			put(
				error,
				name,
				hidden,
				Object.prototype.propertyIsEnumerable.call(value, name),
			);
		}
	}
	if (error === value || readsAsError(error)) return error;
	const plain = plainError(value, mask);
	made.set(value, plain);
	return plain;
}

/** Whether a value is anywhere in it. A list of work: it ends at any depth, and on a cycle. */
function holds(value: unknown, mask: SecretMask): boolean {
	const seen = new Set<unknown>();
	const work = [value];
	while (work.length > 0) {
		const next = work.pop();
		if (typeof next === "string" && mask.text(next) !== next) return true;
		if (typeof next !== "object" || next === null || seen.has(next)) continue;
		seen.add(next);
		if (Array.isArray(next)) for (const item of next) work.push(item);
		else if (next instanceof Error || isPlain(next)) {
			for (const [name, field] of fieldsOf(next)) {
				if (typeof name === "string" && isPlain(next)) work.push(name);
				work.push(field);
			}
		} else work.push(wordsOf(next));
	}
	return false;
}

/** The fields of an object, and what an error's class holds. One that cannot be read shows nothing. */
function fieldsOf(value: object): [string | symbol, unknown][] {
	const names = new Set([
		...Reflect.ownKeys(value),
		...(value instanceof Error ? WORDS : []),
	]);
	return [...names].flatMap((name): [string | symbol, unknown][] => {
		try {
			return Reflect.has(value, name) ? [[name, Reflect.get(value, name)]] : [];
		} catch {
			return [];
		}
	});
}

/** An object of another class (a Response, a Map, a Buffer) as words. */
function wordsOf(value: object): string {
	if (ArrayBuffer.isView(value)) {
		return Buffer.from(
			value.buffer,
			value.byteOffset,
			value.byteLength,
		).toString();
	}
	const items =
		Symbol.iterator in value ? [...(value as Iterable<unknown>)] : [];
	return inspect([value, items], {
		depth: 8,
		maxArrayLength: null,
		maxStringLength: null,
	});
}

function isPlain(value: object): boolean {
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function put(
	target: object,
	name: string | symbol,
	value: unknown,
	enumerable: boolean,
): void {
	// A DOMException has no setter for its message.
	Object.defineProperty(target, name, {
		value,
		enumerable,
		configurable: true,
		writable: true,
	});
}

/** Whether each field with a value can be another one. */
function canChange(error: Error, mask: SecretMask): boolean {
	return fieldsOf(error).every(
		([name, field]) =>
			!holds(field, mask) ||
			(Object.getOwnPropertyDescriptor(error, name)?.configurable ??
				Object.isExtensible(error)),
	);
}

/** A new error of the same class, without its fields yet. */
function shellOf(error: Error, mask: SecretMask): Error {
	return error instanceof DOMException
		? new DOMException(mask.text(error.message), mask.text(error.name))
		: Object.setPrototypeOf(new Error(), Object.getPrototypeOf(error));
}

/** Whether its words read without a throw: a class may keep them in private fields. */
function readsAsError(error: Error): boolean {
	try {
		return typeof error.name === "string" && typeof `${error}` === "string";
	} catch {
		return false;
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
