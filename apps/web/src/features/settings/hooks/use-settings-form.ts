import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SettingsView } from "@/shared/api";
import { settingsMutations, settingsQueries } from "../queries";

export type Settings = SettingsView["values"];
export type SettingKey = keyof Settings;
export type SettingField = SettingsView["fields"][SettingKey];
export type SettingsPatch = { [K in SettingKey]?: Settings[K] | null };

/** How a draft string becomes a value, and what is wrong with it. */
type Kind =
	/** `optional`: empty means none (null), such as no turn limit. */
	| { type: "int"; min: number; max: number; optional?: true }
	| { type: "minutes" }
	/** An amount in US dollars above 0. Empty means none (null): no budget. */
	| { type: "dollars" }
	| { type: "text" }
	/** An `http://` or `https://` address. Empty means none. */
	| { type: "address" }
	| { type: "choice" };

const KINDS: Partial<Record<SettingKey, Kind>> = {
	maxConcurrentRuns: { type: "int", min: 1, max: 16 },
	maxStepsPerRun: { type: "int", min: 1, max: 100_000 },
	budgetUsd: { type: "dollars" },
	maxTurns: { type: "int", min: 1, max: 100_000, optional: true },
	idleMinutes: { type: "minutes" },
	cleanUpAfterDays: { type: "int", min: 1, max: 365 },
	usageLimitFirstWaitMinutes: { type: "minutes" },
	usageLimitMaxWaitMinutes: { type: "minutes" },
	networkGraceMinutes: { type: "minutes" },
	offlineWorkMinutes: { type: "minutes" },
	agentHarness: { type: "choice" },
	agentModel: { type: "text" },
	agentPermissionMode: { type: "choice" },
	decisionDecider: { type: "choice" },
	assistantProfile: { type: "choice" },
	telemetryEndpoint: { type: "address" },
	telemetryProtocol: { type: "choice" },
	ollama: { type: "choice" },
	embeddingModel: { type: "text" },
	ollamaAddress: { type: "address" },
};

const MAX_MINUTES = 10_080;

function parseDraft(
	kind: Kind,
	raw: string,
): { value: unknown } | { error: string } {
	const text = raw.trim();
	switch (kind.type) {
		case "int": {
			if (kind.optional && text === "") return { value: null };
			const n = Number(text);
			if (text === "" || !Number.isInteger(n) || n < kind.min || n > kind.max) {
				return {
					error: `A whole number from ${kind.min} to ${kind.max.toLocaleString("en-US")}.`,
				};
			}
			return { value: n };
		}
		case "minutes": {
			const n = Number(text);
			if (text === "" || !Number.isFinite(n) || n <= 0 || n > MAX_MINUTES) {
				return { error: "More than 0 and at most 10,080 minutes (a week)." };
			}
			return { value: n };
		}
		case "dollars": {
			if (text === "") return { value: null };
			const n = Number(text.replace(/^\$/, ""));
			if (!Number.isFinite(n) || n <= 0 || n > 100_000) {
				return { error: "An amount above 0, for example 5 or 2.50." };
			}
			return { value: n };
		}
		case "text":
			return text === "" ? { error: "Cannot be empty." } : { value: text };
		case "address": {
			if (text === "") return { value: "" };
			try {
				const { protocol } = new URL(text);
				if (protocol === "http:" || protocol === "https:")
					return { value: text };
			} catch {}
			return { error: "Use an address that starts with http:// or https://." };
		}
		case "choice":
			return { value: text };
	}
}

/** How long a field waits after the last keystroke before it saves. */
const SAVE_DELAY_MS = 800;

/**
 * The patch that puts `keys` back as `view` has them: a saved value comes
 * back, a default or outside value is forgotten again.
 */
function restorePatch(
	view: SettingsView,
	keys: readonly SettingKey[],
): SettingsPatch {
	const patch: Record<string, unknown> = {};
	for (const key of keys) {
		patch[key] = view.fields[key].source === "saved" ? view.values[key] : null;
	}
	return patch as SettingsPatch;
}

/** Saves a patch and puts the answer in the cache, so every reader sees it. */
export function useSaveSettings() {
	const queryClient = useQueryClient();
	return useMutation(
		settingsMutations.save({
			onSuccess: (data) => {
				queryClient.setQueryData(settingsQueries.get().queryKey, data);
			},
		}),
	);
}

/**
 * A toast that says what was saved, with Undo. Undo saves `undo`, the
 * values from before the change.
 */
function useUndoToast() {
	const undo = useSaveSettings();
	return (message: string, patch: SettingsPatch) =>
		toast.success(message, {
			action: {
				label: "Undo",
				onClick: () =>
					undo.mutate(patch, {
						onSuccess: () => toast.info("Change undone"),
						onError: (error) => toast.error(`Not undone: ${error.message}`),
					}),
			},
		});
}

/**
 * An on/off setting that saves at once. The switch moves before the daemon
 * answers, and moves back when the save fails. A toast names the section
 * `title` and offers Undo.
 */
export function useToggleSetting(title: string) {
	const queryClient = useQueryClient();
	const queryKey = settingsQueries.get().queryKey;
	const undoToast = useUndoToast();
	return useMutation(
		settingsMutations.save({
			onMutate: async (patch) => {
				await queryClient.cancelQueries({ queryKey });
				const before = queryClient.getQueryData<SettingsView>(queryKey);
				if (before) {
					const values = { ...before.values };
					const fields = { ...before.fields };
					for (const [key, value] of Object.entries(patch) as [
						SettingKey,
						unknown,
					][]) {
						if (value === undefined || value === null) continue;
						(values as Record<SettingKey, unknown>)[key] = value;
						fields[key] = { ...fields[key], source: "saved" };
					}
					queryClient.setQueryData(queryKey, { ...before, values, fields });
				}
				return { before };
			},
			onError: (error, _patch, context) => {
				if (context?.before) queryClient.setQueryData(queryKey, context.before);
				toast.error(`Not saved: ${error.message}`);
			},
			onSuccess: (data, patch, context) => {
				queryClient.setQueryData(queryKey, data);
				if (context?.before) {
					const keys = Object.keys(patch) as SettingKey[];
					undoToast(`${title} saved`, restorePatch(context.before, keys));
				}
			},
		}),
	);
}

/** A setting's value as its field shows it: dollars with cents ("2.50"). */
function shown(key: SettingKey, value: unknown): string {
	if (value === null || value === undefined) return "";
	if (KINDS[key]?.type === "dollars" && typeof value === "number") {
		return value.toFixed(2);
	}
	return String(value);
}

/**
 * The fields of one section. A field with no draft shows the saved value.
 * A change saves itself after a short pause, or at once when the field
 * loses focus. A field that is not valid waits until it is.
 *
 * `title` names the section in toasts. `switches` are the section's
 * on/off settings, which save through `useToggleSetting`: Reset puts them
 * back too.
 */
export function useSettingsForm(
	data: SettingsView,
	keys: readonly SettingKey[],
	{ title, switches = [] }: { title: string; switches?: readonly SettingKey[] },
) {
	const [drafts, setDrafts] = useState<Partial<Record<SettingKey, string>>>({});
	const save = useSaveSettings();
	const reset = useSaveSettings();
	const undoToast = useUndoToast();

	// The timer reads the newest drafts and data, not those of its render.
	const latest = useRef({ drafts, data });
	latest.current = { drafts, data };
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// A setting with no value (no budget) shows an empty field.
	const currentIn = (view: SettingsView, key: SettingKey) =>
		shown(key, view.values[key]);
	const valueIn = (
		view: SettingsView,
		from: Partial<Record<SettingKey, string>>,
		key: SettingKey,
	) => from[key] ?? currentIn(view, key);
	const value = (key: SettingKey) => valueIn(data, drafts, key);

	const errorIn = (
		view: SettingsView,
		from: Partial<Record<SettingKey, string>>,
		key: SettingKey,
	): string | undefined => {
		const kind = KINDS[key];
		if (!kind) return undefined;
		const parsed = parseDraft(kind, valueIn(view, from, key));
		if ("error" in parsed) return parsed.error;
		// The daemon refuses this pair too; say so before the save.
		if (
			key === "usageLimitFirstWaitMinutes" &&
			Number(parsed.value) >
				Number(valueIn(view, from, "usageLimitMaxWaitMinutes"))
		) {
			return "Cannot be longer than the longest usage-limit wait.";
		}
		return undefined;
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: reads refs; keys and title are constants of the card
	const flush = useCallback(() => {
		clearTimeout(timer.current);
		timer.current = undefined;
		const { drafts: from, data: view } = latest.current;
		const patch: Record<string, unknown> = {};
		const sent: Partial<Record<SettingKey, string>> = {};
		for (const key of keys) {
			const draft = from[key];
			if (draft === undefined || draft === currentIn(view, key)) continue;
			const kind = KINDS[key];
			if (!kind || errorIn(view, from, key) !== undefined) continue;
			const parsed = parseDraft(kind, draft);
			if (!("value" in parsed)) continue;
			patch[key] = parsed.value;
			sent[key] = draft;
		}
		const changed = Object.keys(sent) as SettingKey[];
		if (changed.length === 0) return;
		const undo = restorePatch(view, changed);
		save.mutate(patch as SettingsPatch, {
			onSuccess: () => {
				// A field typed in while the save went keeps its newer draft.
				setDrafts((before) => {
					const next = { ...before };
					for (const key of changed) {
						if (next[key] === sent[key]) delete next[key];
					}
					return next;
				});
				undoToast(`${title} saved`, undo);
			},
		});
	}, []);

	// A change that waits when the section goes still saves.
	useEffect(() => flush, [flush]);

	const all = [...keys, ...switches];
	const resettable = all.filter((key) => data.fields[key].source === "saved");

	return {
		value,
		error: (key: SettingKey) => errorIn(data, drafts, key),
		saving: save.isPending,
		saveError: save.error,
		set: (key: SettingKey, next: string) => {
			save.reset();
			setDrafts((before) => ({ ...before, [key]: next }));
			clearTimeout(timer.current);
			timer.current = setTimeout(flush, SAVE_DELAY_MS);
		},
		/** Saves a waiting change now, such as when a field loses focus. */
		flush,
		/** Some setting of the section differs from its default. */
		canReset: resettable.length > 0,
		resetting: reset.isPending,
		/** Puts every setting of the section back to its default. */
		reset: () => {
			clearTimeout(timer.current);
			timer.current = undefined;
			save.reset();
			const undo = restorePatch(data, resettable);
			const patch = Object.fromEntries(resettable.map((key) => [key, null]));
			reset.mutate(patch as SettingsPatch, {
				onSuccess: () => {
					setDrafts({});
					undoToast(`${title} reset to defaults`, undo);
				},
				onError: (resetError) =>
					toast.error(`Not reset: ${resetError.message}`),
			});
		},
	};
}

export type SettingsForm = ReturnType<typeof useSettingsForm>;
