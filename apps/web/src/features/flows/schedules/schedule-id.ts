/** A free schedule id for a flow: its name, else the name with a number. */
export function freeId(flow: string, taken: readonly string[]): string {
	const base = flow.slice(0, 56) || "schedule";
	if (!taken.includes(base)) return base;
	for (let n = 2; ; n++) {
		const id = `${base}-${n}`;
		if (!taken.includes(id)) return id;
	}
}
