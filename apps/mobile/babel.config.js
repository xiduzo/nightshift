/** Only the files of the @orpc packages. A function: Metro also loads this without a file. */
const inOrpc = (filename) =>
	filename != null && /[\\/]@orpc[\\/]/.test(filename);

module.exports = {
	presets: ["babel-preset-expo"],
	plugins: [require("@varlock/expo-integration/babel-plugin")],
	overrides: [
		{
			// Hermes cannot compile a destructured rest parameter, which
			// @orpc/client uses: `async (...[input, options = {}]) => {}`.
			test: inOrpc,
			plugins: ["@babel/plugin-transform-parameters"],
		},
	],
};
