import { describe, expect, test } from "bun:test";
import type { SettingsStore } from "@nightshift/engine/device-config";
import type { Notifications } from "@nightshift/notifications";

import { adoptingSwitches } from "./wire";

/** A settings store that keeps only the three notification switches. */
function switchStore(): SettingsStore {
	const values = {
		notifyGateOpened: true,
		notifyRunFinished: true,
		notifyRunFailed: true,
	};
	const view = () =>
		({ values: { ...values }, fields: {} }) as unknown as ReturnType<
			SettingsStore["view"]
		>;
	return {
		async load() {},
		current: () => view().values,
		view,
		async save(patch) {
			Object.assign(values, patch);
			return view();
		},
		run: () => {
			throw new Error("not used");
		},
		onChange: () => () => {},
	};
}

describe("this computer's settings, as the API saves them", () => {
	test("a save hands the switches to the owner's notification settings", async () => {
		const calls: unknown[] = [];
		const adopt: Notifications["settings"]["adoptComputerSwitches"] = async (
			personId,
			patch,
			switches,
		) => {
			calls.push({ personId, patch, switches });
		};
		const settings = adoptingSwitches(
			switchStore(),
			{
				settings: { adoptComputerSwitches: adopt } as Notifications["settings"],
			},
			"ada",
		);

		const view = await settings.save({ notifyRunFinished: false });

		expect(view.values.notifyRunFinished).toBe(false);
		expect(calls).toEqual([
			{
				personId: "ada",
				patch: { notifyRunFinished: false },
				switches: expect.objectContaining({
					notifyGateOpened: true,
					notifyRunFinished: false,
					notifyRunFailed: true,
				}),
			},
		]);
	});
});
