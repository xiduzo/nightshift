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
			description="When runs start and how far a run can go."
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
										Start flows at their scheduled times. When off, flows run
										only when you start them.
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
										Stay awake while a run works or waits for a timer. A run at
										a Gate lets it sleep.
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
							</div>
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
				</CardForm>
			</Card>
		</PageSection>
	);
}
