import { afterEach, describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { chooseFolder } from "./folder-picker";

/** A computer without the macOS folder picker says so, and how to add a project instead. */

const platform = Object.getOwnPropertyDescriptor(process, "platform");
afterEach(() => {
	if (platform) Object.defineProperty(process, "platform", platform);
});

describe("the folder picker", () => {
	test("refuses on a computer that has none, with what to do instead", async () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		const refused = await chooseFolder("Choose a folder").then(
			() => null,
			(error: unknown) => error,
		);
		expect(refused).toBeInstanceOf(Refusal);
		expect(refused).toMatchObject({
			kind: "unavailable",
			message:
				"This computer cannot open a folder picker. Add the project from GitHub instead.",
		});
	});
});
