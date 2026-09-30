import { PNG } from 'pngjs';
import { writeFile } from 'node:fs/promises';
// Reproducible multi-resolution ICO; 4x coverage sampling keeps the mark crisp.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const distance = (x, y, ax, ay, bx, by) => {
  const t = Math.max(
    0,
    Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)),
  );
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
};
const pngs = sizes.map((size) => {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const rgba = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px = ((x + (sx + 0.5) / 4) * 256) / size,
            py = ((y + (sy + 0.5) / 4) * 256) / size;
          const rx = Math.max(52 - px, px - 204, 0),
            ry = Math.max(52 - py, py - 204, 0);
          if (Math.hypot(rx, ry) > 52) continue;
          let color = [19, 59, 56];
          if (
            [
              [106, 65, 46, 128],
              [46, 128, 106, 191],
              [150, 65, 210, 128],
              [210, 128, 150, 191],
            ].some((l) => distance(px, py, ...l) < 9.5)
          )
            color = [113, 228, 197];
          if (distance(px, py, 144, 57, 112, 199) < 6.5) color = [237, 248, 244];
          for (let i = 0; i < 3; i++) rgba[i] += color[i];
          rgba[3] += 255;
        }
      const offset = (y * size + x) * 4,
        count = rgba[3] / 255;
      for (let i = 0; i < 3; i++) png.data[offset + i] = count ? Math.round(rgba[i] / count) : 0;
      png.data[offset + 3] = Math.round(rgba[3] / 16);
    }
  return PNG.sync.write(png);
});
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const at = 6 + i * 16;
  header[at] = s === 256 ? 0 : s;
  header[at + 1] = header[at];
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(pngs[i].length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += pngs[i].length;
});
await writeFile('build/icon.ico', Buffer.concat([header, ...pngs]));
await writeFile('build/icon.png', pngs.at(-1));
console.log('Generated seven icon sizes.');
