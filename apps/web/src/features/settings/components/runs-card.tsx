import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldSeparator,
} from "@nightshift/ui/components/field";
import { Switch } from "@nightshift/ui/components/switch";
import { LockIcon } from "lucide-react";
import { useId } from "react";
import type { SettingsView } from "@/shared/api";
import { PageSection } from "@/shared/page";
import { useSettingsForm, useToggleSetting } from "../hooks/use-settings-form";
import {
	CardForm,
	ResetSection,
	SaveError,
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
			title="Runs"
			description="When runs start and how far one run may go."
			actions={<ResetSection form={form} />}
		>
			<Card>
				<CardForm form={form}>
					<CardContent>
						<FieldGroup>
							<Field
								orientation="horizontal"
								data-disabled={scheduler.locked ? true : undefined}
							>
								<FieldContent>
									<FieldLabel htmlFor={`${id}-scheduler`}>Schedules</FieldLabel>
									<FieldDescription>
										Night Shift starts flows at the times you schedule. Turn it
										off to run flows only when you start them.
									</FieldDescription>
								</FieldContent>
								<Switch
									id={`${id}-scheduler`}
									checked={data.values.scheduler}
									disabled={Boolean(scheduler.locked) || toggle.isPending}
									aria-describedby={
										scheduler.locked ? `${id}-scheduler-lock` : undefined
									}
									onCheckedChange={(checked) =>
										toggle.mutate({ scheduler: checked })
									}
								/>
							</Field>
							{scheduler.locked ? (
								<Alert id={`${id}-scheduler-lock`}>
									<LockIcon />
									<AlertTitle>Schedules are paused on this computer</AlertTitle>
									<AlertDescription>{scheduler.locked}</AlertDescription>
								</Alert>
							) : null}
							<FieldSeparator />
							<Field orientation="horizontal">
								<FieldContent>
									<FieldLabel htmlFor={`${id}-keep-awake`}>
										Keep this computer awake
									</FieldLabel>
									<FieldDescription>
										This computer does not go to sleep while a run on it works
										or waits for a timer. A run that waits at a Gate does not
										keep it awake.
									</FieldDescription>
								</FieldContent>
								<Switch
									id={`${id}-keep-awake`}
									checked={data.values.keepAwake}
									disabled={toggle.isPending}
									onCheckedChange={(checked) =>
										toggle.mutate({ keepAwake: checked })
									}
								/>
							</Field>
							<FieldSeparator />
							<div className="grid gap-6 sm:grid-cols-2">
								<TextSetting
									form={form}
									settingKey="maxConcurrentRuns"
									label="Max concurrent runs"
									description="How many runs can work at the same time. Extra runs wait their turn."
									inputMode="numeric"
								/>
								<TextSetting
									form={form}
									settingKey="maxStepsPerRun"
									label="Max steps per run"
									description="A safety net for a flow that loops: the run stops after this many steps. You can resume it."
									inputMode="numeric"
								/>
								<TextSetting
									form={form}
									settingKey="offlineWorkMinutes"
									label="Offline limit"
									description="A step this computer runs for a run on another computer stops after this long without its Host."
									unit="min"
									inputMode="decimal"
								/>
							</div>
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
				</CardForm>
			</Card>
		</PageSection>
	);
}
