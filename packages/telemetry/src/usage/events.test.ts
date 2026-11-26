import { expect, test } from "bun:test";
import { USAGE_EVENT } from "@nightshift/semconv";
import { momentEvent } from "./events";
import { attr } from "./fields";

const PLATFORM = { os: "darwin", arch: "arm64", version: "1.0.0" };

test("each reason a schedule did not start leaves as its own skip reason", () => {
	const name = USAGE_EVENT.scheduleSkipped;
	for (const reason of ["missed", "paused", "still_open"] as const) {
		expect(
			momentEvent({ kind: "schedule-skipped", reason }, "key", PLATFORM),
		).toEqual({ name, [attr(name, "schedule.skip_reason")]: reason });
	}
});
