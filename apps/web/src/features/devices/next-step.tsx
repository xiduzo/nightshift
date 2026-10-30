import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { Link } from "@tanstack/react-router";
import {
	BotIcon,
	type LucideIcon,
	PlusIcon,
	RefreshCwIcon,
	ServerIcon,
	SettingsIcon,
	SmartphoneIcon,
	UserPlusIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { SpaceComputer, SpaceView } from "./space-view";

/**
 * The steps that make a Space work across devices, and the card that leads
 * to the first one left. In your personal Space: Be a Host, another
 * computer, your phone. In a shared Space: a member, an Offer, your phone.
 */

/** What the steps need to know of the page. */
export type StepsInput = {
	space: { name: string; personal: boolean };
	view: SpaceView;
	phones: number;
	/** This computer's Be a Host. Null for another Person's computer. */
	beAHost: boolean | null;
	/** "Pair a device", where this computer keeps the Space as a Host. */
	onPair: (() => void) | undefined;
	onPhone: () => void;
	onJoinHost: () => void;
};

type Step = {
	key: string;
	icon: LucideIcon;
	title: string;
	description: string;
	done: boolean;
	action: ReactNode;
	/** A second way, such as "I already have a Host". */
	alternative?: ReactNode;
};

function deviceSteps(input: StepsInput): Step[] {
	const { space, view } = input;
	const self = view.yours.find((c) => c.thisDevice);
	const phone: Step = {
		key: "phone",
		icon: SmartphoneIcon,
		title: "Get Gates on your phone",
		description: "Answer a Gate and follow your runs when you are away.",
		done: input.phones > 0,
		action: (
			<Button size="sm" onClick={input.onPhone}>
				Show me how
			</Button>
		),
	};
	if (!space.personal) {
		return [
			{
				key: "member",
				icon: UserPlusIcon,
				title: "Invite a member",
				description: "Their computers can then run the steps of this Space.",
				done: view.members.length > 0,
				action: (
					<Button
						size="sm"
						nativeButton={false}
						render={<Link to="/members" />}
					>
						<UserPlusIcon data-icon="inline-start" />
						Invite a member
					</Button>
				),
			},
			{
				key: "offer",
				icon: BotIcon,
				title: "Offer a profile to this Space",
				description:
					"Members can then run steps on this computer, with your login and your tools.",
				done: !self || self.offers.length > 0,
				action: (
					<Button size="sm" nativeButton={false} render={<Link to="/agents" />}>
						Offer a profile
					</Button>
				),
			},
			phone,
		];
	}
	const hosted = view.host.kind === "linked" || input.beAHost !== false;
	return [
		{
			key: "host",
			icon: ServerIcon,
			title: "Let your other devices connect",
			description:
				"Your other computers and your phone can then connect to this computer.",
			done: hosted,
			action: <BeAHostButton size="sm" />,
			alternative: (
				<Button variant="ghost" size="sm" onClick={input.onJoinHost}>
					I already have a Host
				</Button>
			),
		},
		{
			key: "computer",
			icon: PlusIcon,
			title: "Add another computer",
			description:
				"Run steps there too, for example on a computer that is on at night.",
			done: view.yours.length > 1,
			action: input.onPair ? (
				<Button size="sm" onClick={input.onPair}>
					<PlusIcon data-icon="inline-start" />
					Pair a device
				</Button>
			) : null,
		},
		phone,
	];
}

/** Opens Settings → This computer, where Be a Host is. */
function BeAHostButton({ size }: { size: "sm" | "xs" }) {
	return (
		<Button
			size={size}
			variant={size === "xs" ? "outline" : "default"}
			nativeButton={false}
			render={<Link to="/settings" hash="this-computer" />}
		>
			<SettingsIcon data-icon="inline-start" />
			{size === "xs" ? "Be a Host" : "Turn on Be a Host"}
		</Button>
	);
}

/**
 * The first step left, in a card on top of the page. "Not now" moves on
 * to the step after it, until the page opens again. Nothing shows once
 * every step is done.
 */
export function NextStepCard(input: StepsInput) {
	const [skipped, setSkipped] = useState<string[]>([]);
	const steps = deviceSteps(input);
	const left = steps.filter((s) => !s.done && s.action);
	const next = left.find((s) => !skipped.includes(s.key));
	if (!next) return null;
	const Icon = next.icon;
	return (
		<Card className="bg-muted/40">
			<CardHeader>
				<div className="flex items-start gap-3">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border [&_svg]:size-5">
						<Icon />
					</div>
					<div className="flex flex-col gap-1">
						<p className="text-muted-foreground text-xs">
							Next step · {steps.length - left.length + 1} of {steps.length}
						</p>
						<CardTitle>{next.title}</CardTitle>
						<CardDescription>{next.description}</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardFooter className="gap-2">
				{next.action}
				{next.alternative}
				<Button
					variant="ghost"
					size="sm"
					className="ml-auto"
					onClick={() => setSkipped((s) => [...s, next.key])}
				>
					Not now
				</Button>
			</CardFooter>
		</Card>
	);
}

/** The one action a computer's own card offers, when it has one. */
export function ComputerNudge({
	computer,
	input,
}: {
	computer: SpaceComputer;
	input: StepsInput;
}) {
	if (computer.paired?.revokedAt != null && input.onPair) {
		return (
			<Button size="xs" variant="outline" onClick={input.onPair}>
				<RefreshCwIcon data-icon="inline-start" />
				Pair again
			</Button>
		);
	}
	if (!computer.thisDevice) return null;
	if (!input.space.personal && computer.offers.length === 0) {
		return (
			<Button
				size="xs"
				variant="outline"
				nativeButton={false}
				render={<Link to="/agents" />}
			>
				Offer a profile
			</Button>
		);
	}
	if (
		input.space.personal &&
		input.beAHost === false &&
		input.view.host.kind !== "linked"
	) {
		return <BeAHostButton size="xs" />;
	}
	return null;
}
