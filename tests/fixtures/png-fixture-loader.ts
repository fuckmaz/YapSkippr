import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { PNG } from 'pngjs';

export async function loadPngFixture(filePath: string): Promise<ImageData> {
  if (extname(filePath).toLowerCase() !== '.png') {
    throw new Error(`Detector fixture must be a PNG file: ${filePath}`);
  }

  // API: https://github.com/pngjs/pngjs#pngsync
  const decoded = PNG.sync.read(await readFile(filePath));
  const expectedBytes = decoded.width * decoded.height * 4;
  if (decoded.data.length !== expectedBytes) {
    throw new Error(`PNG fixture did not decode to RGBA pixels: ${filePath}`);
  }

  return {
    data: new Uint8ClampedArray(decoded.data),
    width: decoded.width,
    height: decoded.height,
    colorSpace: 'srgb'
  } as ImageData;
}
