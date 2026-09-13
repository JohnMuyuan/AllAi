// Raster icons come from packaging/icon-source.png (copied into the repo).
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

async function main() {
  const root = path.join(__dirname, "..");
  const source = path.join(root, "packaging/icon-source.png");
  const png = (size) =>
    sharp(source).resize(size, size).ensureAlpha().png({ palette: false }).toBuffer();
  await fs.writeFile(path.join(root, "packaging/icon.png"), await png(1024));
  await fs.writeFile(path.join(root, "app/icon.png"), await png(256));
  await fs.writeFile(path.join(root, "app/apple-icon.png"), await png(180));
  await fs.writeFile(path.join(root, "public/logo.png"), await png(256));
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map(png));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  const ico = Buffer.concat([header, ...images]);
  await fs.writeFile(path.join(root, "app/favicon.ico"), ico);
  await fs.writeFile(path.join(root, "packaging/icon.ico"), ico);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
