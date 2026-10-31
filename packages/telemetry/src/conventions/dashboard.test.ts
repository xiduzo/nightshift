import { describe, expect, test } from "bun:test";
import { ATTR, METRIC } from "./index";

/**
 * The Grafana dashboard in docs/deploy reads the names the export writes.
 * Prometheus spells a name with `_` for `.`, adds `_seconds` for a unit of
 * seconds, and `_total`, `_bucket`, `_sum` or `_count` for the series kind.
 */
const DASHBOARD = new URL(
	"../../../../docs/deploy/grafana/nightshift.json",
	import.meta.url,
);

const prom = (name: string) => name.replaceAll(".", "_");

function knownNames(): Set<string> {
	const known = new Set(Object.values(ATTR).map(prom));
	for (const { name, unit } of Object.values(METRIC)) {
		const base = prom(name) + (unit === "s" ? "_seconds" : "");
		for (const suffix of ["", "_total", "_bucket", "_sum", "_count"]) {
			known.add(base + suffix);
		}
	}
	return known;
}

describe("the Grafana dashboard", () => {
	test("reads only names the export writes", async () => {
		const text = await Bun.file(DASHBOARD).text();
		const used = new Set(text.match(/\b(?:nightshift|gen_ai)_[a-z_]+/g) ?? []);
		expect(used.size).toBeGreaterThan(0);
		const known = knownNames();
		expect([...used].filter((name) => !known.has(name))).toEqual([]);
	});

	test("groups only by labels the export writes", async () => {
		const text = await Bun.file(DASHBOARD).text();
		const labels = [...text.matchAll(/by \(([^)]*)\)/g)].flatMap((match) =>
			(match[1] ?? "").split(",").map((label) => label.trim()),
		);
		const known = new Set([...Object.values(ATTR).map(prom), "le"]);
		expect(labels.filter((label) => !known.has(label))).toEqual([]);
	});
});
