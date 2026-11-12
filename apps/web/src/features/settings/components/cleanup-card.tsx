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
	const id = useId();

	return (
		<PageSection
			title="Cleanup"
			description="Remove what old runs leave on this computer."
			actions={<ResetSection form={form} />}
		>
			<Card>
				<CardForm form={form}>
					<CardContent>
						<FieldGroup>
							<Field orientation="horizontal">
								<FieldContent>
									<FieldLabel htmlFor={`${id}-cleanup`}>
										Clean up old runs
									</FieldLabel>
									<FieldDescription>
										A day after a run ends, Night Shift removes its copy of the
										project and its branches. Branches on origin stay, and work
										saved nowhere else stays hidden for the days below, then
										goes.
									</FieldDescription>
								</FieldContent>
								<Switch
									id={`${id}-cleanup`}
									checked={data.values.cleanUpRuns}
									disabled={toggle.isPending}
									onCheckedChange={(checked) =>
										toggle.mutate({ cleanUpRuns: checked })
									}
								/>
							</Field>
							<FieldSeparator />
							<div className="grid gap-6 sm:grid-cols-2">
								<TextSetting
									form={form}
									settingKey="cleanUpAfterDays"
									label="Clean up after"
									unit="days"
									description="How long hidden work, and the files of a run without a project folder, stay after the run ends."
									inputMode="numeric"
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
