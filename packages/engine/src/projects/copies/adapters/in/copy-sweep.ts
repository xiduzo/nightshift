/**
 * The timer of the copies: it sweeps now, then every `intervalMs`, until
 * it stops. It imports nothing of the slice: the wire hands it the bound
 * sweep.
 */
export function createCopySweep(deps: {
	sweep(): Promise<void>;
	intervalMs: number;
}) {
	let timer: ReturnType<typeof setInterval> | null = null;
	const sweep = {
		start() {
			sweep.stop();
			void deps.sweep();
			timer = setInterval(() => void deps.sweep(), deps.intervalMs);
		},
		stop() {
			if (timer) clearInterval(timer);
			timer = null;
		},
	};
	return sweep;
}
