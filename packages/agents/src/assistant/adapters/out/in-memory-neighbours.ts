import type { HistoryPort } from "../../domain/history-port";

export function inMemoryHistoryPort(): HistoryPort {
	throw new Error("Tests build their own HistoryPort.");
}
