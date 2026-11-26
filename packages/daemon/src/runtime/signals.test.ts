import { afterEach, expect, spyOn, test } from "bun:test";
import { hot } from "./hot";
import { afterStops } from "./signals";

afterEach(() => {
	hot.nightshiftStopping = undefined;
});

test("a start that waits a short time for a stop says nothing", async () => {
	hot.nightshiftStopping = Bun.sleep(50);
	const said = spyOn(console, "log");
	try {
		await afterStops();
		// Past the moment it would have said it waits.
		await Bun.sleep(3_200);
		expect(said).not.toHaveBeenCalled();
	} finally {
		said.mockRestore();
	}
}, 10_000);
