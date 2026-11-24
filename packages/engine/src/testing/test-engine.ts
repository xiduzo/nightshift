import { createEngine } from "../wire";
import { lifetimeOf } from "./test-support";

/** `createEngine` for a test: the engine ends with its sandbox, also without a `dispose`. */
export const createTestEngine: typeof createEngine = (deps, internals = {}) => {
	const { signal } = lifetimeOf(deps.db);
	return createEngine(deps, {
		...internals,
		signal: internals.signal
			? AbortSignal.any([internals.signal, signal])
			: signal,
	});
};
