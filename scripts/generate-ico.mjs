/**
 * Generate a Windows .ico file from the existing PNG icon.
 * ICO format supports embedded PNG (since Windows Vista).
 *
 * Usage: node scripts/generate-ico.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const png = readFileSync("assets/icons/SatMouse-Default-1024x1024@1x.png");

// ICO header (6 bytes)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);      // reserved
header.writeUInt16LE(1, 2);      // type: 1 = icon
header.writeUInt16LE(1, 4);      // image count: 1

// Directory entry (16 bytes)
const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0);          // width: 0 = 256px
entry.writeUInt8(0, 1);          // height: 0 = 256px
entry.writeUInt8(0, 2);          // color palette: 0 (no palette)
entry.writeUInt8(0, 3);          // reserved
entry.writeUInt16LE(1, 4);       // color planes
entry.writeUInt16LE(32, 6);      // bits per pixel
entry.writeUInt32LE(png.length, 8);  // image data size
entry.writeUInt32LE(22, 12);     // offset to image data (6 + 16)

const ico = Buffer.concat([header, entry, png]);
writeFileSync("assets/icons/SatMouse.ico", ico);
console.log(`Created assets/icons/SatMouse.ico (${ico.length} bytes)`);
