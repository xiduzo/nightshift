import { z } from "zod";
import { type DeviceDocument, mapView } from "../../../../documents";
import type { SecretFacts } from "../../application/ports";
import { savedSecretSchema } from "../../domain/secret-views";

/**
 * The facts of this computer's secrets in its Device document: the key
 * `secrets` of its facts (the saved names with when each was set) and the
 * key `secretsUsedAt` (when each name was last used). A read parses the
 * facts again only after they changed. A write is one change of the
 * document. Values never enter it.
 */
export function yjsSecretFacts(
	document: Pick<DeviceDocument, "facts" | "revision" | "change">,
): SecretFacts {
	const saved = mapView(document, document.facts, () => {
		const stored = document.facts.get("secrets");
		const out = new Map<string, number | null>();
		for (const item of Array.isArray(stored) ? stored : []) {
			const parsed = savedSecretSchema.safeParse(item);
			if (parsed.success) out.set(parsed.data.name, parsed.data.setAt);
		}
		return out;
	});
	const usedAt = mapView(document, document.facts, () => {
		const parsed = z
			.record(z.string(), z.unknown())
			.safeParse(document.facts.get("secretsUsedAt"));
		const out = new Map<string, number>();
		for (const [name, at] of Object.entries(
			parsed.success ? parsed.data : {},
		)) {
			if (typeof at === "number") out.set(name, at);
		}
		return out;
	});
	return {
		saved,
		usedAt,
		writeSaved: (next, forget = []) =>
			document.change(() => {
				document.facts.set(
					"secrets",
					[...next.keys()].sort().map((name) => ({
						name,
						setAt: next.get(name) ?? null,
					})),
				);
				const used = usedAt();
				if (forget.some((name) => used.has(name))) {
					const kept = new Map(used);
					for (const name of forget) kept.delete(name);
					document.facts.set("secretsUsedAt", Object.fromEntries(kept));
				}
			}),
		writeUsed: (used) =>
			document.change(() => {
				document.facts.set("secretsUsedAt", Object.fromEntries(used));
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
