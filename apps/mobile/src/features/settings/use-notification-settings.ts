import {
	applySettingsPatch,
	createNotificationQueries,
	type NotificationSettings,
	type NotificationSettingsPatch,
} from "@nightshift/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert as NativeAlert } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";

/** The person's notification settings on the Host, the same on every screen. */
export function useNotificationSettings() {
	const queries = useHostQueries(createNotificationQueries);
	return useQuery(queries.settings());
}

/** Saves one change to the notification settings at once. The screen shows it before the Host answers. */
export function useSaveNotificationSettings(): (
	patch: NotificationSettingsPatch,
) => void {
	const queries = useHostQueries(createNotificationQueries);
	const { host } = useSignedIn();
	const queryClient = useQueryClient();
	const key = queries.settings().queryKey;

	const save = useMutation(
		host.orpc.notifications.settings.save.mutationOptions({
			onMutate: async (patch: NotificationSettingsPatch) => {
				await queryClient.cancelQueries({ queryKey: key });
				const before = queryClient.getQueryData<NotificationSettings>(key);
				if (before)
					queryClient.setQueryData(key, applySettingsPatch(before, patch));
				return { before };
			},
			onSuccess: (saved) => queryClient.setQueryData(key, saved),
			onError: (error, _patch, context) => {
				if (context?.before) queryClient.setQueryData(key, context.before);
				NativeAlert.alert("The change was not saved", error.message);
			},
		}),
	);
	return save.mutate;
}
