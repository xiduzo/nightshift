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
			<CardForm form={form}>
				<SettingRows>
					<ResumeSetting data={data} />
					<TextSetting
						form={form}
						settingKey="budgetUsd"
						label="Budget per run"
						description="The run stops at this amount. Resume it to spend as much again."
						unit="USD"
						inputMode="decimal"
						placeholder="No budget"
					/>
					<TextSetting
						form={form}
						settingKey="maxTurns"
						label="Max turns per agent step"
						description="A turn is one reply of the agent. The step fails after this many."
						inputMode="numeric"
						placeholder="No limit"
					/>
					<TextSetting
						form={form}
						settingKey="idleMinutes"
						label="Idle timeout"
						description="The step fails when the agent does nothing for this long."
						unit="min"
						inputMode="decimal"
					/>
					<TextSetting
						form={form}
						settingKey="usageLimitFirstWaitMinutes"
						label="First usage-limit wait"
						description="When an agent hits its usage limit without a reset time, the run waits this long."
						unit="min"
						inputMode="decimal"
					/>
					<TextSetting
						form={form}
						settingKey="usageLimitMaxWaitMinutes"
						label="Longest usage-limit wait"
						description="Each next wait doubles, up to this."
						unit="min"
						inputMode="decimal"
					/>
					<TextSetting
						form={form}
						settingKey="networkGraceMinutes"
						label="Network grace"
						description="How long a step waits for the network before it fails."
						unit="min"
						inputMode="decimal"
					/>
					<SaveErrorRow error={form.saveError} />
				</SettingRows>
			</CardForm>
		</PageSection>
	);
}

/** Whether a run the daemon stopped mid-step continues on its own. Saves at once. */
function ResumeSetting({ data }: { data: SettingsView }) {
	const toggle = useToggleSetting("Run policy");
	return (
		<SwitchSetting
			label="Resume after a restart"
			description="A run that Night Shift stopped continues when it starts again. This works with schedules on, before the stop time, up to 3 times in a row."
			checked={data.values.resumeInterruptedRuns}
			disabled={toggle.isPending}
			onCheckedChange={(checked) =>
				toggle.mutate({ resumeInterruptedRuns: checked })
			}
		/>
	);
}
