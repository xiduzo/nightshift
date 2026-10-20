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
import { useId } from "react";
import type { SettingsView } from "@/shared/api";
import { PageSection } from "@/shared/page";
import { useSettingsForm, useToggleSetting } from "../hooks/use-settings-form";
import {
	CardForm,
	FormFooter,
	SaveError,
	SettingSource,
	TextSetting,
} from "./setting-fields";

const POLICY_KEYS = [
	"usageLimitFirstWaitMinutes",
	"usageLimitMaxWaitMinutes",
	"networkGraceMinutes",
] as const;

export function RunPolicyCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, POLICY_KEYS);
	return (
		<PageSection
			title="Run policy"
			description="Defaults for flows that do not set their own."
		>
			<Card>
				<CardForm form={form}>
					<CardContent>
						<FieldGroup>
							<ResumeSetting data={data} />
							<FieldSeparator />
							<div className="grid gap-6 sm:grid-cols-2">
								<TextSetting
									form={form}
									data={data}
									settingKey="usageLimitFirstWaitMinutes"
									label="First usage-limit wait"
									description="An agent hits its usage limit and gives no reset time. The run waits this long, then tries again."
									unit="min"
									inputMode="decimal"
								/>
								<TextSetting
									form={form}
									data={data}
									settingKey="usageLimitMaxWaitMinutes"
									label="Longest usage-limit wait"
									description="Each next wait is twice as long, up to this."
									unit="min"
									inputMode="decimal"
								/>
								<TextSetting
									form={form}
									data={data}
									settingKey="networkGraceMinutes"
									label="Network grace"
									description="The longest total wait for the network to come back. Then the step fails."
									unit="min"
									inputMode="decimal"
								/>
							</div>
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
					<FormFooter form={form} label="Save run policy" />
				</CardForm>
			</Card>
		</PageSection>
	);
}

/** Whether a run the daemon stopped mid-step continues on its own. Saves at once. */
function ResumeSetting({ data }: { data: SettingsView }) {
	const id = useId();
	const toggle = useToggleSetting();
	const label = "Resume after a restart";
	return (
		<Field orientation="horizontal">
			<FieldContent>
				<FieldLabel htmlFor={`${id}-resume`}>{label}</FieldLabel>
				<FieldDescription>
					When Night Shift stops in the middle of a run, the run continues on
					its own after Night Shift starts again. This works only with schedules
					on, before the run's stop time, and up to 3 times in a row. Turn it
					off to resume runs yourself.
				</FieldDescription>
				<SettingSource
					field={data.fields.resumeInterruptedRuns}
					label={label}
					format={(value) => (value ? "on" : "off")}
					resetting={
						toggle.isPending && toggle.variables?.resumeInterruptedRuns === null
					}
					onReset={() => toggle.mutate({ resumeInterruptedRuns: null })}
				/>
			</FieldContent>
			<Switch
				id={`${id}-resume`}
				checked={data.values.resumeInterruptedRuns}
				disabled={toggle.isPending}
				onCheckedChange={(checked) =>
					toggle.mutate({ resumeInterruptedRuns: checked })
				}
			/>
		</Field>
	);
}
