/**
 * Draws every Night Shift icon from one mark and puts each file where its
 * app reads it: the web app (favicons, Home Screen icons), the phone app
 * (app icon, Android layers, splash) and the desktop app (app icons, menu
 * bar icon).
 *
 *   bun run icons                                  # the marks in scripts/icons/
 *   bun run icons <mark.svg|png> [--light <mark>]  # a new mark
 *
 * The mark is a square SVG or PNG: the logo on a clear background, drawn
 * for a dark background and filling the square. `--light` is the same logo
 * for a light background (the light favicon and splash). It defaults to the
 * mark. A PNG should be at least 1024 pixels wide.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";

import { Resvg } from "@resvg/resvg-js";

const root = join(import.meta.dir, "..");
const DARK = "#0a0a0a";
const WAITING_LIGHT = "#975800";
const WAITING_DARK = "#f7bc50";

const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: { light: { type: "string" } },
	allowPositionals: true,
});
const markPath = positionals[0] ?? join(import.meta.dir, "icons/mark.svg");
const lightPath =
	values.light ??
	(positionals[0] ? markPath : join(import.meta.dir, "icons/mark-light.svg"));

/** A mark as a data URL, to place in an SVG. */
function dataUrl(path: string): string {
	const type = { ".svg": "image/svg+xml", ".png": "image/png" }[
		extname(path).toLowerCase()
	];
	if (!type) throw new Error(`Give an SVG or PNG file, not ${path}.`);
	return `data:${type};base64,${readFileSync(path).toString("base64")}`;
}
const mark = dataUrl(markPath);
const markLight = dataUrl(lightPath);

/** The mark, centred in a 64-unit square at `size` units wide. */
function place(href: string, size: number, attributes = ""): string {
	const at = (64 - size) / 2;
	return `<image href="${href}" x="${at}" y="${at}" width="${size}" height="${size}" ${attributes}/>`;
}

/** Paints the mark one colour and keeps its shape. */
function silhouette(colour: string): string {
	const [r, g, b] = [1, 3, 5].map(
		(i) => Number.parseInt(colour.slice(i, i + 2), 16) / 255,
	);
	return `<filter id="s" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 1 0"/></filter>`;
}

const svg = (body: string, title = "Night Shift") =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>${title}</title>${body}</svg>\n`;

// A full square tile, for the Home Screen, iOS and Windows.
const tile = svg(
	`<rect width="64" height="64" fill="${DARK}"/>${place(mark, 37)}`,
);
// The macOS grid: a rounded square of 824/1024, with a margin around it.
const macTile = svg(
	`<rect x="6.25" y="6.25" width="51.5" height="51.5" rx="11.6" fill="${DARK}"/>${place(mark, 30)}`,
);
// Android adaptive layers: the mark inside the safe zone, on its own.
const androidForeground = svg(place(mark, 27));
const androidBackground = svg(`<rect width="64" height="64" fill="${DARK}"/>`);
const androidMonochrome = svg(
	`${silhouette("#ffffff")}${place(mark, 27, 'filter="url(#s)"')}`,
);
// Splash: the mark alone, in the colours of each theme.
const splashLight = svg(place(markLight, 52));
const splashDark = svg(place(mark, 52));
// macOS menu bar: a template image, black on clear. macOS tints it.
const tray = svg(
	`${silhouette("#000000")}${place(mark, 60, 'filter="url(#s)"')}`,
);

// The browser tab: the mark in the colours of the browser theme.
const themed =
	"<style>.dark{display:none}@media (prefers-color-scheme: dark){.light{display:none}.dark{display:inline}}</style>";
const favicon = svg(
	`${themed}${place(markLight, 54, 'class="light"')}${place(mark, 54, 'class="dark"')}`,
);
// The tab when a Gate waits: a dot in the corner, cut out of the mark.
const faviconWaiting = svg(
	`${themed}<style>.dot{fill:${WAITING_LIGHT}}@media (prefers-color-scheme: dark){.dot{fill:${WAITING_DARK}}}</style>
	<mask id="cut"><rect width="64" height="64" fill="#fff"/><circle cx="50" cy="14" r="17" fill="#000"/></mask>
	<g mask="url(#cut)">${place(markLight, 54, 'class="light"')}${place(mark, 54, 'class="dark"')}</g>
	<circle class="dot" cx="50" cy="14" r="13"/>`,
	"Night Shift: a Gate waits for you",
);

function write(path: string, data: string | Buffer) {
	const out = join(root, path);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, data);
	console.log(path);
}

function png(source: string, size: number, path: string) {
	const image = new Resvg(source, {
		fitTo: { mode: "width", value: size },
		font: { loadSystemFonts: false },
	});
	write(path, image.render().asPng());
}

const web = "apps/web/public";
write(`${web}/favicon.svg`, favicon);
write(`${web}/favicon-waiting.svg`, faviconWaiting);
write(`${web}/app-icon.svg`, tile);
png(tile, 180, `${web}/apple-touch-icon.png`);
png(tile, 192, `${web}/icon-192.png`);
png(tile, 512, `${web}/icon-512.png`);

const mobile = "apps/mobile/assets/images";
png(tile, 1024, `${mobile}/icon.png`);
png(tile, 48, `${mobile}/favicon.png`);
png(androidForeground, 512, `${mobile}/android-icon-foreground.png`);
png(androidBackground, 512, `${mobile}/android-icon-background.png`);
png(androidMonochrome, 432, `${mobile}/android-icon-monochrome.png`);
png(splashLight, 1024, `${mobile}/splash-icon.png`);
png(splashDark, 1024, `${mobile}/splash-icon-dark.png`);

const desktop = "apps/desktop/assets";
for (const size of [16, 32, 128, 256, 512]) {
	png(macTile, size, `${desktop}/icon.iconset/icon_${size}x${size}.png`);
	png(macTile, size * 2, `${desktop}/icon.iconset/icon_${size}x${size}@2x.png`);
}
png(tile, 512, `${desktop}/icon.png`);
// 18 points in the menu bar, drawn at twice that for Retina screens.
png(tray, 36, `${desktop}/tray-icon.png`);
