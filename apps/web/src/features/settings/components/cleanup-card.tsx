import type { SettingsView } from "@/shared/api";
import { PageSection, SettingRows } from "@/shared/page";
import { useSettingsForm, useToggleSetting } from "../hooks/use-settings-form";
import {
	CardForm,
	ResetSection,
	SaveErrorRow,
	SwitchSetting,
	TextSetting,
} from "./setting-fields";

const CLEANUP_KEYS = ["cleanUpAfterDays"] as const;

/**
 * The scheduled cleanup of what ended runs left on this computer: their
 * copies of the project and branches a day after the run, the work it
 * kept of them, and the files of runs without a project folder.
 */
export function CleanupCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, CLEANUP_KEYS, {
		title: "Cleanup",
		switches: ["cleanUpRuns"],
	});
	const toggle = useToggleSetting("Cleanup");

	return (
		<PageSection
			title="Cleanup"
			description="Remove what old runs leave on this computer."
			actions={<ResetSection form={form} />}
		>
			<CardForm form={form}>
				<SettingRows>
					<SwitchSetting
						label="Clean up old runs"
						description="A day after a run ends, Night Shift removes its copy of the project and its branches. Branches on origin stay, and work saved nowhere else stays hidden for the days below, then goes."
						checked={data.values.cleanUpRuns}
						disabled={toggle.isPending}
						onCheckedChange={(checked) =>
							toggle.mutate({ cleanUpRuns: checked })
						}
					/>
					<TextSetting
						form={form}
						settingKey="cleanUpAfterDays"
						label="Clean up after"
						unit="days"
						description="How long hidden work, and the files of a run without a project folder, stay after the run ends."
						inputMode="numeric"
					/>
					<SaveErrorRow error={form.saveError} />
				</SettingRows>
			</CardForm>
		</PageSection>
	);
}
