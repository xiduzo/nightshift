/** One resource a tool server lists. */
export type ToolServerResource = {
	uri: string;
	name: string;
	title?: string;
	description?: string;
	mimeType?: string;
	size?: number;
};