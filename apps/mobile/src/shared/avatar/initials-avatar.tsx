import {
	Avatar,
	AvatarFallback,
} from "@nightshift/ui-native/components/ui/avatar";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";

import { initialsOf } from "./initials";

const SIZE = {
	/** A list row. */
	sm: { box: "size-8", text: "text-xs" },
	/** A header button: 44 pt. */
	md: { box: "size-11", text: "text-sm" },
} as const;

/** A person or a project as their initials on a muted circle. A screen reader hears the name. */
export function InitialsAvatar({
	name,
	size = "sm",
	className,
}: {
	name: string;
	size?: keyof typeof SIZE;
	className?: string;
}) {
	return (
		<Avatar alt={name} className={cn(SIZE[size].box, className)}>
			<AvatarFallback>
				<Text className={cn("font-semibold", SIZE[size].text)}>
					{initialsOf(name)}
				</Text>
			</AvatarFallback>
		</Avatar>
	);
}
