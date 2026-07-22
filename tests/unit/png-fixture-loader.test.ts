import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { PNG } from 'pngjs';
import { loadPngFixture } from '../fixtures/png-fixture-loader';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

test('loads a PNG fixture as RGBA ImageData', async () => {
  const directory = await makeTemporaryDirectory();
  const fixturePath = join(directory, 'generated-frame.png');
  const png = new PNG({ width: 2, height: 1 });
  png.data = Buffer.from([
    12, 34, 56, 255,
    210, 180, 140, 128
  ]);
  await writeFile(fixturePath, PNG.sync.write(png));

  const imageData = await loadPngFixture(fixturePath);

  expect(imageData).toMatchObject({ width: 2, height: 1, colorSpace: 'srgb' });
  expect(Array.from(imageData.data)).toEqual([
    12, 34, 56, 255,
    210, 180, 140, 128
  ]);
});

test('rejects non-PNG fixture paths before reading them', async () => {
  const directory = await makeTemporaryDirectory();

  await expect(loadPngFixture(join(directory, 'captured-frame.webp'))).rejects.toThrow(
    'Detector fixture must be a PNG file'
  );
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'yapskippr-png-fixture-'));
  temporaryDirectories.push(directory);
  return directory;
}
