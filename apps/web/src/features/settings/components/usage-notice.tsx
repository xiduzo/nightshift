import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import { FieldGroup } from "@nightshift/ui/components/field";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useToggleSetting } from "../hooks/use-settings-form";
import { settingsQueries } from "../queries";
import { readUsage, usagePatch } from "../usage-setting";
import { UsageSendsButton, UsageSendsSheet } from "./usage-sends-sheet";
import { UsageSwitch } from "./usage-switch";

/**
 * The first start: Night Shift sends anonymous usage, and you can turn it
 * off before anything leaves. Closing the dialog, or the switch, saves
 * `usageSeen` so it does not show again.
 */
export function UsageNotice() {
	const settings = useQuery(settingsQueries.get());
	const toggle = useToggleSetting("Monitoring");
	const [open, setOpen] = useState(false);
	const [sends, setSends] = useState(false);
	const asked = useRef(false);
	const sent = useRef<{ usage: boolean } | null>(null);
	const data = settings.data;

	useEffect(() => {
		if (!data || asked.current) return;
		asked.current = true;
		if (!readUsage(data).seen) setOpen(true);
	}, [data]);

	function persist(usage: boolean) {
		if (sent.current?.usage === usage) return;
		sent.current = { usage };
		toggle.mutate(usagePatch({ usage, usageSeen: true }), {
			onError: () => {
				sent.current = null;
			},
		});
	}

	const usage = data ? readUsage(data) : undefined;

	return (
		<Dialog
			open={open}
			disablePointerDismissal={sends}
			onOpenChange={(next) => {
				if (next) return;
				setOpen(false);
				if (usage) persist(sent.current?.usage ?? usage.on);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Night Shift sends anonymous usage</DialogTitle>
					<DialogDescription>You can turn it off.</DialogDescription>
				</DialogHeader>
				{usage ? (
					<FieldGroup>
						<UsageSwitch
							checked={usage.on}
							locked={usage.locked}
							pending={toggle.isPending}
							onCheckedChange={(checked) => persist(checked)}
						/>
						<UsageSendsButton onClick={() => setSends(true)} />
					</FieldGroup>
				) : null}
				<DialogFooter>
					<DialogClose render={<Button type="button" />}>Continue</DialogClose>
				</DialogFooter>
			</DialogContent>
			<UsageSendsSheet open={sends} onOpenChange={setSends} />
		</Dialog>
	);
}
