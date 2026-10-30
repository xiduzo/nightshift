import { applySettingsPatch } from "@nightshift/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { NotificationSettings } from "@/shared/api";
import { notificationMutations, notificationQueries } from "./queries";

/**
 * Saves a change of your notification settings at once. The page shows
 * the change before the answer comes, and goes back with a toast when it
 * is not saved.
 */
export function useSaveSettings() {
	const queryClient = useQueryClient();
	const queryKey = notificationQueries.settings().queryKey;
	return useMutation(
		notificationMutations.saveSettings({
			onMutate: async (patch) => {
				await queryClient.cancelQueries({ queryKey });
				const before = queryClient.getQueryData<NotificationSettings>(queryKey);
				if (before) {
					queryClient.setQueryData<NotificationSettings>(
						queryKey,
						applySettingsPatch(before, patch),
					);
				}
				return { before };
			},
			onSuccess: (saved) => queryClient.setQueryData(queryKey, saved),
			onError: (error, _patch, context) => {
				if (context?.before) queryClient.setQueryData(queryKey, context.before);
				toast.error(`Not saved: ${error.message}`);
			},
		}),
	);
}
