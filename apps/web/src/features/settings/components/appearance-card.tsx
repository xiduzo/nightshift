import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Field,
	FieldContent,
	FieldLabel,
	FieldTitle,
} from "@nightshift/ui/components/field";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui/components/radio-group";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";
import { PageSection } from "@/shared/page";

const THEMES = [
	{
		value: "system",
		label: "System",

		icon: MonitorIcon,
	},
	{
		value: "dark",
		label: "Dark",

		icon: MoonIcon,
	},
	{
		value: "light",
		label: "Light",

		icon: SunIcon,
	},
] as const;

export function AppearanceCard() {
	const id = useId();
	const { theme, setTheme } = useTheme();
	// next-themes knows the theme only after it mounts in the browser.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	return (
		<PageSection title="Appearance" description="Applies to this browser only.">
			<Card>
				<CardContent>
					<RadioGroup
						aria-label="Theme"
						value={mounted ? (theme ?? "system") : null}
						onValueChange={(value) => setTheme(String(value))}
						className="grid gap-3 sm:grid-cols-3"
					>
						{THEMES.map(({ value, label, icon: Icon }) => (
							<FieldLabel key={value} htmlFor={`${id}-${value}`}>
								<Field orientation="horizontal">
									<FieldContent>
										<FieldTitle>
											<Icon className="size-4" aria-hidden="true" />
											{label}
										</FieldTitle>
									</FieldContent>
									<RadioGroupItem value={value} id={`${id}-${value}`} />
								</Field>
							</FieldLabel>
						))}
					</RadioGroup>
				</CardContent>
			</Card>
		</PageSection>
	);
}
