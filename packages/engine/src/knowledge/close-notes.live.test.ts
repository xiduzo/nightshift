/**
 * The line of close notes against the real Ollama: one run of a model trial
 * (`embedding-model.ts`). Runs only when `OLLAMA_LIVE_MODEL` names a pulled
 * model, so the default test run never loads a model. It prints what
 * `docs/knowledge.md` records:
 *
 *   OLLAMA_LIVE_MODEL=qwen3-embedding:0.6b bun test src/knowledge/close-notes.live.test.ts
 *
 * `OLLAMA_LIVE_ADDRESS`: another Ollama than the default on this computer.
 */

import { describe, expect, test } from "bun:test";
import {
	ALMOST_THE_SAME_NOTES,
	DISAGREEING_NOTES,
	OTHER_NOTES,
	RELATED_NOTES,
	SAME_NOTES,
} from "../testing/fixtures/close-notes";
import { ollamaMeaning } from "./meaning";

const model = process.env.OLLAMA_LIVE_MODEL ?? "";
const address = process.env.OLLAMA_LIVE_ADDRESS ?? "http://127.0.0.1:11434";
const meaning = ollamaMeaning({ model, address });
const live = model !== "" && (await meaning.ready()) === "ready";

const groups = {
	same: SAME_NOTES,
	almost: ALMOST_THE_SAME_NOTES,
	disagree: DISAGREEING_NOTES,
	related: RELATED_NOTES,
};

function cosine(a: readonly number[], b: readonly number[]): number {
	let dot = 0;
	let left = 0;
	let right = 0;
	for (const [i, x] of a.entries()) {
		const y = b[i] as number;
		dot += x * y;
		left += x * x;
		right += y * y;
	}
	return dot / Math.sqrt(left * right);
}

function spread(scores: readonly number[]): string {
	const sorted = [...scores].sort((a, b) => a - b);
	const at = (part: number) =>
		(
			sorted[Math.min(sorted.length - 1, Math.floor(part * sorted.length))] ?? 0
		).toFixed(3);
	return `n ${sorted.length}, least ${at(0)}, p10 ${at(0.1)}, middle ${at(0.5)}, p90 ${at(0.9)}, most ${at(1)}`;
}

describe.skipIf(!live)(`The line of close notes on ${model}`, () => {
	test("finds what repeats, and leaves out what is only related", async () => {
		const texts = [
			...new Set([...Object.values(groups).flat(2), ...OTHER_NOTES]),
		];
		const vectors = await meaning.embeddings.embedDocuments(texts);
		const vectorOf = new Map(texts.map((text, i) => [text, vectors[i] ?? []]));
		const score = (a: string, b: string) =>
			cosine(vectorOf.get(a) ?? [], vectorOf.get(b) ?? []);

		// Two notes that any pair links are of one subject: all other pairs are not.
		const parent = new Map<string, string>();
		const root = (text: string): string => {
			const up = parent.get(text) ?? text;
			return up === text ? text : root(up);
		};
		for (const pairs of Object.values(groups)) {
			for (const [a, b] of pairs) parent.set(root(a), root(b));
		}
		const across: number[] = [];
		const acrossClose: string[] = [];
		const line = meaning.closeNotesAt ?? 1;
		for (const [i, a] of texts.entries()) {
			for (const b of texts.slice(i + 1)) {
				if (root(a) === root(b)) continue;
				const similarity = score(a, b);
				across.push(similarity);
				if (similarity >= line) {
					acrossClose.push(`${similarity.toFixed(3)} ${a} | ${b}`);
				}
			}
		}

		console.log(`${texts.length} notes, line ${line}`);
		const atLine: Record<string, number> = {};
		for (const [name, pairs] of Object.entries(groups)) {
			const scores = pairs.map(([a, b]) => score(a, b));
			atLine[name] = scores.filter((s) => s >= line).length;
			console.log(
				`${name}: ${spread(scores)}; at the line or above ${atLine[name]}`,
			);
		}
		console.log(
			`other subjects: ${spread(across)}; at the line or above ${acrossClose.length}`,
		);
		for (const pair of acrossClose) console.log(`  ${pair}`);

		expect(atLine.same).toBe(SAME_NOTES.length);
		expect(atLine.almost).toBe(ALMOST_THE_SAME_NOTES.length);
		expect(atLine.related).toBe(0);
		expect(acrossClose).toEqual([]);
	}, 300_000);
});
