import { describe, expect, test } from "bun:test";

import { redactError } from "./redact-error";
import { secretMask } from "./secret-mask";

const VALUE = "pine-4711-apple";
const hide = (error: unknown) => redactError(error, secretMask([VALUE]));

describe("an error that cannot change", () => {
	for (const still of [Object.freeze, Object.seal, Object.preventExtensions]) {
		test(`${still.name}: keeps its class, its words and its own fields`, () => {
			class NightError extends Error {
				code = "E_NIGHT";
				more = { at: 1 };
			}
			const cause = new Error(`deep ${VALUE}`);
			const error = new NightError(`bad ${VALUE}`, { cause });
			error.name = "Night";
			const out = hide(still(error)) as NightError;
			expect(out).toBeInstanceOf(NightError);
			expect(out.message).toBe("bad •••");
			expect([out.code, out.name, out.more]).toEqual([
				"E_NIGHT",
				"Night",
				{ at: 1 },
			]);
			expect((out.cause as Error).message).toBe("deep •••");
			expect(out.stack).not.toContain(VALUE);
			expect(Object.keys(out).sort()).toEqual(["code", "more", "name"]);
		});
	}

	test("with nothing to hide it is the same error", () => {
		const error = Object.freeze(new TypeError("bad"));
		expect(hide(error)).toBe(error);
	});

	test("an abort stays an abort", () => {
		const out = hide(
			Object.freeze(new DOMException(`bad ${VALUE}`, "AbortError")),
		) as DOMException;
		expect(out).toBeInstanceOf(DOMException);
		expect([out.name, out.message, out.code]).toEqual([
			"AbortError",
			"bad •••",
			20,
		]);
		const own = hide(
			Object.freeze(Object.assign(new Error(VALUE), { name: "AbortError" })),
		) as Error;
		expect([own.name, own.message]).toEqual(["AbortError", "•••"]);
	});

	test("that is its own cause, or the cause of another, shows no value", () => {
		const one: Error = new Error(`one ${VALUE}`);
		one.cause = one;
		const out = hide(Object.freeze(one)) as Error;
		expect(out.cause).toBe(out);
		const a: Error = new Error(`a ${VALUE}`);
		const b: Error = new Error(`b ${VALUE}`, { cause: a });
		a.cause = b;
		Object.freeze(a);
		Object.freeze(b);
		const pair = hide(a) as Error;
		expect(pair.message).toBe("a •••");
		expect(Bun.inspect(pair)).not.toContain(VALUE);
	});

	test("whose copy does not work is a plain error with the hidden words", () => {
		class Closed extends Error {
			#words = "x";
			override get name() {
				return this.#words;
			}
			override toString() {
				return this.#words;
			}
		}
		const out = hide(Object.freeze(new Closed(`bad ${VALUE}`))) as Error;
		expect(out.message).toBe("bad •••");
		expect(Object.getPrototypeOf(out)).toBe(Error.prototype);
	});
});

test("a field that cannot be read does not replace the error", () => {
	const error = new Error(`bad ${VALUE}`);
	Object.defineProperty(error, "odd", {
		get() {
			throw new RangeError("odd");
		},
	});
	expect(hide(error)).toBe(error);
	expect(error.message).toBe("bad •••");
});

test("an object of a class in a field goes as a whole when it holds a value", () => {
	const error = Object.assign(new Error("bad"), {
		headers: new Headers({ authorization: VALUE }),
		names: new Map([["k", VALUE]]),
		bytes: Buffer.from(`x ${VALUE}`),
		page: new URL("https://a.example/"),
	});
	const out = hide(error) as typeof error;
	for (const name of ["headers", "names", "bytes"] as const) {
		expect<unknown>(out[name]).toBe("•••");
	}
	expect(out.page).toBeInstanceOf(URL);
});

test("data too deep to walk is a plain error with the hidden words", () => {
	let data: unknown = VALUE;
	for (let i = 0; i < 100_000; i++) data = [data];
	const out = hide(
		Object.assign(new Error(`bad ${VALUE}`), { data, name: "AbortError" }),
	) as Error;
	expect(out.name).toBe("AbortError");
	expect(out.message).toBe("bad •••");
	expect("data" in out).toBe(false);
});
