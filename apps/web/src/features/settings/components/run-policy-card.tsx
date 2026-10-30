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
	ResetSection,
	SaveError,
	TextSetting,
} from "./setting-fields";

const POLICY_KEYS = [
	"budgetUsd",
	"maxTurns",
	"idleMinutes",
	"usageLimitFirstWaitMinutes",
	"usageLimitMaxWaitMinutes",
	"networkGraceMinutes",
] as const;

export function RunPolicyCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, POLICY_KEYS, {
		title: "Run policy",
		switches: ["resumeInterruptedRuns"],
	});
	return (
		<PageSection
			title="Run policy"
			description="Defaults for flows that do not set their own."
			actions={<ResetSection form={form} />}
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
									settingKey="budgetUsd"
									label="Budget per run"
									description="A run stops when it has spent this much. Resume it to spend as much again. Leave it empty for no budget."
									unit="USD"
									inputMode="decimal"
									placeholder="No budget"
								/>
								<TextSetting
									form={form}
									settingKey="maxTurns"
									label="Max turns per agent step"
									description="A turn is one reply of the agent. The step fails when the agent takes more. Leave it empty for no limit."
									inputMode="numeric"
									placeholder="No limit"
								/>
								<TextSetting
									form={form}
									settingKey="idleMinutes"
									label="Idle timeout"
									description="An agent step fails when the agent shows no activity for this long."
									unit="min"
									inputMode="decimal"
								/>
								<TextSetting
									form={form}
									settingKey="usageLimitFirstWaitMinutes"
									label="First usage-limit wait"
									description="An agent hits its usage limit and gives no reset time. The run waits this long, then tries again."
									unit="min"
									inputMode="decimal"
								/>
								<TextSetting
									form={form}
									settingKey="usageLimitMaxWaitMinutes"
									label="Longest usage-limit wait"
									description="Each next wait is twice as long, up to this."
									unit="min"
									inputMode="decimal"
								/>
								<TextSetting
									form={form}
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
				</CardForm>
			</Card>
		</PageSection>
	);
}

/** Whether a run the daemon stopped mid-step continues on its own. Saves at once. */
function ResumeSetting({ data }: { data: SettingsView }) {
	const id = useId();
	const toggle = useToggleSetting("Run policy");
	return (
		<Field orientation="horizontal">
			<FieldContent>
				<FieldLabel htmlFor={`${id}-resume`}>Resume after a restart</FieldLabel>
				<FieldDescription>
					When Night Shift stops in the middle of a run, the run continues on
					its own after Night Shift starts again. This works only with schedules
					on, before the run's stop time, and up to 3 times in a row. Turn it
					off to resume runs yourself.
				</FieldDescription>
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
