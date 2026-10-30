import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import { Link } from "@tanstack/react-router";
import { CircleAlertIcon, SettingsIcon } from "lucide-react";

/**
 * How to get Night Shift on a phone: the app signs in to the Host of the
 * Space. Without a Host to sign in to, it leads to Be a Host.
 */
export function PhoneHowToDialog({
	open,
	onOpenChange,
	address,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Where the phone signs in. Undefined when there is no Host to sign in to. */
	address: string | undefined;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Get Night Shift on your phone</DialogTitle>
					<DialogDescription>
						Your phone shows your runs, and tells you when a Gate waits for you.
					</DialogDescription>
				</DialogHeader>
				{address ? (
					<ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
						<li>Install the Night Shift app on your phone.</li>
						<li>
							Sign in with your account at this address:
							<code className="mt-1 block break-all rounded bg-muted px-2 py-1 text-xs">
								{address}
							</code>
						</li>
						<li>Allow notifications when the app asks.</li>
					</ol>
				) : (
					<Alert>
						<CircleAlertIcon />
						<AlertTitle>Your phone needs a Host</AlertTitle>
						<AlertDescription>
							Turn on Be a Host on this computer first. Your phone then signs in
							to it.
						</AlertDescription>
					</Alert>
				)}
				<DialogFooter>
					{address ? (
						<Button onClick={() => onOpenChange(false)}>Done</Button>
					) : (
						<Button
							nativeButton={false}
							render={<Link to="/settings" hash="this-computer" />}
						>
							<SettingsIcon data-icon="inline-start" />
							Turn on Be a Host
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
