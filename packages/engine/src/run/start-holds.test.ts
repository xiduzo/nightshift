import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { createStartHolds, START_HOLD_WORDS } from "./start-holds";

/** A promise and the function that resolves it. */
function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("the start holds", () => {
	test("a start in a held Space is refused; other Spaces start; a release frees it", async () => {
		const holds = createStartHolds();
		const release = await holds.hold("space-a");

		const refused = holds.start("space-a", async () => "run");
		await expect(refused).rejects.toBeInstanceOf(Refusal);
		await expect(refused).rejects.toThrow(START_HOLD_WORDS.held);
		expect(await holds.start("space-b", async () => "other")).toBe("other");

		release();
		expect(await holds.start("space-a", async () => "run")).toBe("run");
	});

	test("a hold waits for the starts under way in its Space, failed ones too", async () => {
		const holds = createStartHolds();
		const running = deferred<string>();
		const failing = deferred<string>();
		const started = holds.start("space-a", () => running.promise);
		const broken = holds.start("space-a", () =>
			failing.promise.then(() => {
				throw new Error("The start failed.");
			}),
		);
		let held = false;
		const holding = holds.hold("space-a").then((release) => {
			held = true;
			return release;
		});

		await Bun.sleep(0);
		expect(held).toBe(false);
		running.resolve("run");
		failing.resolve("");
		await expect(broken).rejects.toThrow("The start failed.");
		const release = await holding;
		expect(held).toBe(true);
		expect(await started).toBe("run");
		release();
	});

	test("two holds of a Space free it when both are released, and a release twice counts once", async () => {
		const holds = createStartHolds();
		const first = await holds.hold("space-a");
		const second = await holds.hold("space-a");

		first();
		first();
		await expect(holds.start("space-a", async () => "run")).rejects.toThrow(
			START_HOLD_WORDS.held,
		);
		second();
		expect(await holds.start("space-a", async () => "run")).toBe("run");
	});

	test("a start that waits begins once the last hold is released, and no hold waits for it", async () => {
		const holds = createStartHolds();
		const first = await holds.hold("space-a");
		let began = false;
		const waiting = holds.start(
			"space-a",
			async () => {
				began = true;
				return "resumed";
			},
			"wait",
		);
		// A second hold does not wait for a start that has not begun.
		const second = await holds.hold("space-a");
		first();
		await Bun.sleep(0);
		expect(began).toBe(false);

		second();
		expect(await waiting).toBe("resumed");
		expect(began).toBe(true);
	});
});
