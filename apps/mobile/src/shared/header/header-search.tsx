import { Stack } from "expo-router";

/**
 * The system search field in a screen's native header. On iOS it sits
 * under the large title and stays there while the page scrolls. On
 * Android it is a search icon in the top app bar. The screen shows what
 * it finds while the field holds a query. Cancel or close clears it.
 */
export function HeaderSearch({
	placeholder,
	onChange,
}: {
	placeholder: string;
	onChange: (query: string) => void;
}) {
	return (
		<Stack.SearchBar
			placeholder={placeholder}
			placement="stacked"
			hideWhenScrolling={false}
			obscureBackground={false}
			autoCapitalize="none"
			onChangeText={(event) => onChange(event.nativeEvent.text)}
			onCancelButtonPress={() => onChange("")}
			onClose={() => onChange("")}
		/>
	);
}
