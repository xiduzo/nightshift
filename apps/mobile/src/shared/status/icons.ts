import {
	Bot,
	CircleAlert,
	CircleCheck,
	CircleDashed,
	CircleDot,
	CircleStop,
	CircleX,
	Flag,
	Hand,
	Hourglass,
	LoaderCircle,
	type LucideIcon,
	MessageCircleQuestion,
	Moon,
	Plug,
	Split,
	SquareFunction,
	SquareTerminal,
	Variable,
} from "lucide-react-native";

import type { StatusIconName, StepKindIconName } from "@/shared/tone";

const ICONS: Record<StatusIconName | StepKindIconName, LucideIcon> = {
	loader: LoaderCircle,
	hourglass: Hourglass,
	moon: Moon,
	"circle-check": CircleCheck,
	"circle-stop": CircleStop,
	"circle-x": CircleX,
	"circle-alert": CircleAlert,
	"circle-dot": CircleDot,
	"circle-dashed": CircleDashed,
	"message-question": MessageCircleQuestion,
	hand: Hand,
	bot: Bot,
	terminal: SquareTerminal,
	split: Split,
	function: SquareFunction,
	variable: Variable,
	plug: Plug,
	flag: Flag,
};

/** The lucide icon of a status or a step kind. */
export function iconOf(name: StatusIconName | StepKindIconName): LucideIcon {
	return ICONS[name];
}
