/** Where a tap on a notification goes, on any screen. */
export type PushRoute =
	| { to: "gate"; runId: string; stepId: string }
	| { to: "run"; runId: string }
	| { to: "inbox" };

/**
 * Where a tap on a notification goes: a run's end, or a step that waits
 * for a Device, opens the run. A Gate opens the Gate. Anything else opens
 * the inbox. A run and a Gate open
 * from any of the Person's Spaces, so a route names no Space.
 */
export function routeOf(data: {
	kind: string;
	runId: string | null;
	stepId: string | null;
}): PushRoute {
	if (
		(data.kind === "run-finished" ||
			data.kind === "run-failed" ||
			data.kind === "device-wait") &&
		data.runId
	) {
		return { to: "run", runId: data.runId };
	}
	if (data.kind === "gate-opened" && data.runId && data.stepId) {
		return { to: "gate", runId: data.runId, stepId: data.stepId };
	}
	return { to: "inbox" };
}

/** The path of the route in the web app: the browser and the desktop app open it. */
export function webPathOf(route: PushRoute): string {
	switch (route.to) {
		case "gate":
			return `/inbox?gate=${encodeURIComponent(route.stepId)}`;
		case "run":
			return `/runs/${encodeURIComponent(route.runId)}`;
		case "inbox":
			return "/inbox";
	}
}
