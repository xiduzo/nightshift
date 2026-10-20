/**
 * A fake `grok -p … --output-format streaming-json`, for the Grok Build
 * harness tests. It prints grok's native events: the answer text (with the
 * report line Night Shift asked for) and `end` with the session id.
 *
 * `FAKE_GROK_LOG`: a file that gets the argv as one JSON line.
 * `FAKE_GROK_ERROR`: print an `error` event with this message instead.
 */
import { appendFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (process.env.FAKE_GROK_LOG) {
	appendFileSync(process.env.FAKE_GROK_LOG, `${JSON.stringify({ argv })}\n`);
}
const print = (event: Record<string, unknown>) =>
	process.stdout.write(`${JSON.stringify(event)}\n`);

if (process.env.FAKE_GROK_ERROR) {
	print({ type: "error", message: process.env.FAKE_GROK_ERROR });
	process.exit(1);
}
print({ type: "thought", data: "Reading the tests." });
print({ type: "text", data: "The tests pass.\n" });
print({
	type: "text",
	data: 'NIGHTSHIFT-REPORT: {"outcome":"pass","summary":"The tests pass."}',
});
print({ type: "end", stopReason: "end_turn", sessionId: "grok-session-1" });
