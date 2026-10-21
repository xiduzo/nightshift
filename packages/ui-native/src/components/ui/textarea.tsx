import { cn } from "@nightshift/ui-native/lib/utils";
import { Platform, TextInput } from "react-native";

function Textarea({
	className,
	multiline = true,
	numberOfLines = Platform.select({ web: 2, native: 8 }), // On web, numberOfLines also determines initial height. On native, it determines the maximum height.
	placeholderClassName,
	...props
}: React.ComponentProps<typeof TextInput> &
	React.RefAttributes<TextInput> & {
		// Night Shift: Uniwind 1.13 types no placeholderClassName on TextInput.
		// Declared here so the component still takes it off the props. The
		// placeholder color is a `placeholder:` class, as in input.tsx.
		placeholderClassName?: string;
	}) {
	return (
		<TextInput
			className={cn(
				"text-foreground border-input dark:bg-input/30 flex min-h-16 w-full flex-row rounded-md border bg-transparent px-3 py-2 text-base shadow-sm shadow-black/5 md:text-sm",
				Platform.select({
					web: "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive field-sizing-content resize-y outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed",
				}),
				props.editable === false && "opacity-50",
				Platform.select({ native: "placeholder:text-muted-foreground/50" }),
				className,
			)}
			multiline={multiline}
			numberOfLines={numberOfLines}
			textAlignVertical="top"
			{...props}
		/>
	);
}

export { Textarea };
