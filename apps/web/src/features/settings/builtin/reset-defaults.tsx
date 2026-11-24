/** "Reset to defaults" for one table of the settings that new work starts with. */

import { Button } from "@nightshift/ui/components/button";
import { Spinner } from "@nightshift/ui/components/spinner";
import { RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import type { SettingsView } from "@/shared/api";
import { toastFailure } from "@/shared/failure";
import { type SettingKey, type SettingsPatch, useSaveSettings } from "../form";

/**
 * "Reset to defaults" for one table, beside its title. It shows when a
 * setting of `keys` differs from its default.
 */
export function ResetDefaults({
	data,
	keys,
	title,
}: {
	data: SettingsView;
	keys: readonly SettingKey[];
	/** The table's name, in the toast. */
	title: string;
}) {
	const reset = useSaveSettings();
	const saved = keys.filter((key) => data.fields[key]?.source === "saved");
	if (saved.length === 0) return null;
	const patch = (value: (key: SettingKey) => unknown) =>
		Object.fromEntries(saved.map((key) => [key, value(key)])) as SettingsPatch;
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			disabled={reset.isPending}
			onClick={() => {
				const before = patch((key) => data.values[key]);
				reset.mutate(
					patch(() => null),
					{
						onSuccess: () =>
							toast.success(`${title} reset to defaults`, {
								action: {
									label: "Undo",
									onClick: () =>
										reset.mutate(before, {
											onError: toastFailure("Not undone"),
										}),
								},
							}),
						onError: toastFailure("Not reset"),
					},
				);
			}}
		>
			{reset.isPending ? (
				<Spinner data-icon="inline-start" />
			) : (
				<RotateCcwIcon data-icon="inline-start" />
			)}
			Reset to defaults
		</Button>
	);
}
