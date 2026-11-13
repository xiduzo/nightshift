import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { LockIcon } from "lucide-react";
import { useId } from "react";
import type { SettingsView } from "@/shared/api";
import { PageSection, SettingNote, SettingRows } from "@/shared/page";
import { useSettingsForm, useToggleSetting } from "../hooks/use-settings-form";
import {
	CardForm,
	ResetSection,
	SaveErrorRow,
	SwitchSetting,
	TextSetting,
} from "./setting-fields";

const RUN_KEYS = [
	"maxConcurrentRuns",
	"maxStepsPerRun",
	"offlineWorkMinutes",
] as const;

export function RunsCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, RUN_KEYS, {
		title: "Runs",
		switches: ["scheduler", "keepAwake"],
	});
	const toggle = useToggleSetting("Runs");
	const scheduler = data.fields.scheduler;
	const id = useId();

	return (
		<PageSection
			title="Starts and limits"
			description="When runs start and how far a run can go."
			actions={<ResetSection form={form} />}
		>
			<CardForm form={form}>
				<SettingRows>
					<SwitchSetting
						label="Schedules"
						description="Start flows at their scheduled times. When off, flows run only when you start them."
						checked={data.values.scheduler}
						disabled={Boolean(scheduler.locked) || toggle.isPending}
						describedBy={scheduler.locked ? `${id}-scheduler-lock` : undefined}
						onCheckedChange={(checked) => toggle.mutate({ scheduler: checked })}
					/>
					{scheduler.locked ? (
						<SettingNote>
							<Alert id={`${id}-scheduler-lock`}>
								<LockIcon />
								<AlertTitle>Schedules are paused on this computer</AlertTitle>
								<AlertDescription>{scheduler.locked}</AlertDescription>
							</Alert>
						</SettingNote>
					) : null}
					<SwitchSetting
						label="Keep this computer awake"
						description="Stay awake while a run works or waits for a timer. A run at a Gate lets it sleep."
						checked={data.values.keepAwake}
						disabled={toggle.isPending}
						onCheckedChange={(checked) => toggle.mutate({ keepAwake: checked })}
					/>
					<TextSetting
						form={form}
						settingKey="maxConcurrentRuns"
						label="Max concurrent runs"
						description="More runs wait their turn."
						inputMode="numeric"
					/>
					<TextSetting
						form={form}
						settingKey="maxStepsPerRun"
						label="Max steps per run"
						description="Stops a flow that loops. You can resume the run."
						inputMode="numeric"
					/>
					<TextSetting
						form={form}
						settingKey="offlineWorkMinutes"
						label="Offline limit"
						description="A step for a run on another computer stops when its Host is gone this long."
						unit="min"
						inputMode="decimal"
					/>
					<SaveErrorRow error={form.saveError} />
				</SettingRows>
			</CardForm>
		</PageSection>
	);
}
