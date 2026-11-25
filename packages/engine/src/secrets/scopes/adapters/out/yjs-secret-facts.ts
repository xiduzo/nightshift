import { z } from "zod";
import { type DeviceDocument, mapView } from "../../../../documents";
import type { SecretFacts } from "../../application/ports";
import { savedSecretSchema } from "../../domain/secret-views";

/**
 * The facts of this computer's secrets in its Device document: the key
 * `secrets` of its facts (the saved names with when each was set) and the
 * key `secretsUsedAt` (when each name was last used). A read parses the
 * facts again only after they changed. A write is one change of the
 * document. An entry it cannot read stays as it is, in its place. Values
 * never enter it.
 */
export function yjsSecretFacts(
	document: Pick<DeviceDocument, "facts" | "revision" | "change">,
): SecretFacts {
	const storedSaved = (): unknown[] => {
		const stored = document.facts.get("secrets");
		return Array.isArray(stored) ? stored : [];
	};
	const storedUsed = (): Record<string, unknown> => {
		const parsed = z
			.record(z.string(), z.unknown())
			.safeParse(document.facts.get("secretsUsedAt"));
		return parsed.success ? parsed.data : {};
	};
	const saved = mapView(document, document.facts, () => {
		const out = new Map<string, number | null>();
		for (const item of storedSaved()) {
			const parsed = savedSecretSchema.safeParse(item);
			if (parsed.success) out.set(parsed.data.name, parsed.data.setAt);
		}
		return out;
	});
	const usedAt = mapView(document, document.facts, () => {
		const out = new Map<string, number>();
		for (const [name, at] of Object.entries(storedUsed())) {
			if (typeof at === "number") out.set(name, at);
		}
		return out;
	});
	return {
		saved,
		usedAt,
		writeSaved: (next, forget = []) =>
			document.change(() => {
				document.facts.set("secrets", savedEntries(storedSaved(), next));
				const used = storedUsed();
				if (forget.some((name) => name in used)) {
					const kept = { ...used };
					for (const name of forget) delete kept[name];
					document.facts.set("secretsUsedAt", kept);
				}
			}),
		writeUsed: (used) =>
			document.change(() => {
				const unread = Object.entries(storedUsed()).filter(
					([, at]) => typeof at !== "number",
				);
				document.facts.set(
					"secretsUsedAt",
					Object.fromEntries([...unread, ...used]),
				);
			}),
		onSavedChange(listener) {
			const observer = (event: { keysChanged: Set<string> }) => {
				if (event.keysChanged.has("secrets")) listener();
			};
			document.facts.observe(observer);
			return () => document.facts.unobserve(observer);
		},
	};
}

/**
 * The list to store for the saved names `next`, sorted. What is stored and
 * did not change stays as it is. What does not read keeps its place.
 */
function savedEntries(
	stored: readonly unknown[],
	next: ReadonlyMap<string, number | null>,
): unknown[] {
	const readable = stored.flatMap((item) => {
		const parsed = savedSecretSchema.safeParse(item);
		return parsed.success ? [{ item, ...parsed.data }] : [];
	});
	const list: unknown[] = [...next.keys()].sort().map((name) => {
		const setAt = next.get(name) ?? null;
		const same = readable.find((s) => s.name === name && s.setAt === setAt);
		return same?.item ?? { name, setAt };
	});
	for (const [place, item] of stored.entries()) {
		if (!savedSecretSchema.safeParse(item).success) list.splice(place, 0, item);
	}
	return list;
}
