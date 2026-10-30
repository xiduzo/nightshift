import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
		case "choice":
			return { value: text };
	}
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
 * An on/off setting that saves at once. The switch moves before the daemon
 * answers, and moves back when the save fails.
 */
export function useToggleSetting() {
	const queryClient = useQueryClient();
	const queryKey = settingsQueries.get().queryKey;
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
			onSuccess: (data) => queryClient.setQueryData(queryKey, data),
		}),
	);
}

/**
 * The drafts of one card's fields. A field with no draft shows the saved
 * value. Save sends the fields that changed; Reset forgets a saved value.
 */
export function useSettingsForm(
	data: SettingsView,
	keys: readonly SettingKey[],
) {
	const [drafts, setDrafts] = useState<Partial<Record<SettingKey, string>>>({});
	const save = useSaveSettings();
	const reset = useSaveSettings();

	// A setting with no value (no budget) shows an empty field.
	const current = (key: SettingKey) =>
		data.values[key] === null ? "" : String(data.values[key]);
	const value = (key: SettingKey) => drafts[key] ?? current(key);
	const changed = keys.filter(
		(key) => drafts[key] !== undefined && drafts[key] !== current(key),
	);
	const error = (key: SettingKey): string | undefined => {
		const kind = KINDS[key];
		if (!kind) return undefined;
		const parsed = parseDraft(kind, value(key));
		if ("error" in parsed) return parsed.error;
		// The daemon refuses this pair too; say so before the save.
		if (
			key === "usageLimitFirstWaitMinutes" &&
			Number(parsed.value) > Number(value("usageLimitMaxWaitMinutes"))
		) {
			return "Cannot be longer than the longest usage-limit wait.";
		}
		return undefined;
	};
	const invalid = keys.some((key) => error(key) !== undefined);

	return {
		value,
		error,
		dirty: changed.length > 0,
		invalid,
		saving: save.isPending,
		saveError: save.error,
		resettingKey: reset.isPending
			? (Object.keys(reset.variables ?? {})[0] as SettingKey | undefined)
			: undefined,
		set: (key: SettingKey, next: string) => {
			save.reset();
			setDrafts((before) => ({ ...before, [key]: next }));
		},
		discard: () => {
			save.reset();
			setDrafts({});
		},
		save: () => {
			const patch: Record<string, unknown> = {};
			for (const key of changed) {
				const kind = KINDS[key];
				if (!kind) continue;
				const parsed = parseDraft(kind, value(key));
				if ("value" in parsed) patch[key] = parsed.value;
			}
			save.mutate(patch as SettingsPatch, {
				onSuccess: () => {
					setDrafts({});
					toast.success("Settings saved");
				},
			});
		},
		reset: (key: SettingKey, label: string) => {
			reset.mutate({ [key]: null } as SettingsPatch, {
				onSuccess: (next) => {
					setDrafts((before) => {
						const { [key]: _dropped, ...rest } = before;
						return rest;
					});
					toast.success(
						`${label} reset to ${next.values[key] === null ? "no limit" : String(next.values[key])}`,
					);
				},
				onError: (resetError) => toast.error(resetError.message),
			});
		},
	};
}

export type SettingsForm = ReturnType<typeof useSettingsForm>;
