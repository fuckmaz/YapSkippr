import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

// Deterministic, self-authored video-frame composites. These are generated
// assets rather than third-party captures so every committed pixel has clear
// provenance and can be reproduced with `node tests/fixtures/generate-detector-fixtures.mjs`.
const QR_MATRICES = {
  'https://sponsor.example/offer': [
    '11111110100011001111101111111', '10000010001011111000001000001',
    '10111010100011111101101011101', '10111010110001101111001011101',
    '10111010100001001011001011101', '10000010100100000111101000001',
    '11111110101010101010101111111', '00000000000001110001000000000',
    '00111111001011101010010111101', '01111000101110110001001111100',
    '00000110001000001010100100010', '00110001010011010001001000100',
    '10110111110010001011101011000', '00001101000001110000011101000',
    '00101110100101101001011010001', '10001101110001111100011111000',
    '10110110010110100101101001010', '00011100111010101010100010100',
    '10011010010001010101010000111', '10011000010011000100111101101',
    '10101010111101100100111110010', '00000000001001000011100011101',
    '11111110110101110101101010111', '10000010110101110100100011110',
    '10111010110001000111111110101', '10111010100110101000011001111',
    '10111010100010101110111011101', '10000010000100010001110000110',
    '11111110010001000100110010000'
  ],
  'https://x.co/y': [
    '111111101001001111111', '100000100111101000001', '101110101001001011101',
    '101110101100001011101', '101110101001001011101', '100000101000101000001',
    '111111101010101111111', '000000000000100000000', '001111110000110111101',
    '010100001101000000011', '001110100100001010000', '011100010111100110110',
    '101011110010001000101', '000000000111100001010', '111111101110110011101',
    '100000101110011110101', '101110101101110111010', '101110101101110110011',
    '101110101111011101110', '100000100110001010001', '111111100100110110000'
  ]
};

const directory = dirname(fileURLToPath(import.meta.url));
let seed = 0x59a5c1;

function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}

function frame(width, height, palette = [22, 35, 58]) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const wave = Math.sin(x / 29) * 8 + Math.cos(y / 21) * 7;
      const vignette = Math.hypot(x - width / 2, y - height / 2) / Math.max(width, height) * 18;
      const noise = ((Math.floor(x / 4) * 17 + Math.floor(y / 4) * 31) % 9) - 4;
      pixel(png, x, y, palette.map((value, channel) => value + wave - vignette + noise + channel * 2));
    }
  }
  // Self-authored scene shapes approximate a defocused studio/video background.
  circle(png, Math.round(width * 0.25), Math.round(height * 0.42), Math.round(height * 0.23), [52, 89, 118]);
  circle(png, Math.round(width * 0.58), Math.round(height * 0.36), Math.round(height * 0.16), [119, 65, 89]);
  rect(png, 0, Math.round(height * 0.72), width, Math.round(height * 0.28), [17, 24, 38]);
  return png;
}

function pixel(png, x, y, color) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const offset = (y * png.width + x) * 4;
  png.data[offset] = clamp(color[0] ?? 0);
  png.data[offset + 1] = clamp(color[1] ?? 0);
  png.data[offset + 2] = clamp(color[2] ?? 0);
  png.data[offset + 3] = 255;
}

function clamp(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function rect(png, left, top, width, height, color) {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) pixel(png, x, y, color);
  }
}

function circle(png, centerX, centerY, radius, color) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) pixel(png, x, y, color);
    }
  }
}

function qr(png, value, left, top, scale, dark = [12, 12, 18], light = [245, 242, 231]) {
  const matrix = QR_MATRICES[value];
  const quiet = 4;
  const modules = matrix.length;
  for (let moduleY = -quiet; moduleY < modules + quiet; moduleY += 1) {
    for (let moduleX = -quiet; moduleX < modules + quiet; moduleX += 1) {
      const isDark = moduleX >= 0 && moduleY >= 0 && moduleX < modules && moduleY < modules
        && matrix[moduleY]?.[moduleX] === '1';
      rect(png, left + (moduleX + quiet) * scale, top + (moduleY + quiet) * scale, scale, scale, isDark ? dark : light);
    }
  }
}

function progress(png, y, startX, fillEndX, endX, rows = 3, fill = [246, 249, 252], track = [88, 92, 99]) {
  rect(png, startX, y, endX - startX + 1, rows, track);
  rect(png, startX, y, fillEndX - startX + 1, rows, fill);
}

function blockQuantize(png, size = 6, step = 14) {
  for (let blockY = 0; blockY < png.height; blockY += size) {
    for (let blockX = 0; blockX < png.width; blockX += size) {
      for (let y = blockY; y < Math.min(blockY + size, png.height); y += 1) {
        for (let x = blockX; x < Math.min(blockX + size, png.width); x += 1) {
          const offset = (y * png.width + x) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            png.data[offset + channel] = Math.round((png.data[offset + channel] ?? 0) / step) * step;
          }
        }
      }
    }
  }
}

function blur(png) {
  const source = Buffer.from(png.data);
  for (let y = 1; y < png.height - 1; y += 1) {
    for (let x = 1; x < png.width - 1; x += 1) {
      const target = (y * png.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let total = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            total += source[((y + dy) * png.width + x + dx) * 4 + channel] ?? 0;
          }
        }
        png.data[target + channel] = Math.round(total / 9);
      }
    }
  }
}

async function save(name, png) {
  await writeFile(join(directory, name), PNG.sync.write(png, { colorType: 6 }));
}

async function generateQrFixtures() {
  const clean = frame(384, 216);
  qr(clean, 'https://sponsor.example/offer', 255, 36, 3);
  await save('qr-sponsor-landscape-clean.png', clean);

  const compressed = frame(480, 270, [67, 80, 93]);
  blockQuantize(compressed);
  qr(compressed, 'https://sponsor.example/offer', 388, 24, 2, [63, 65, 69], [190, 191, 187]);
  await save('qr-sponsor-small-compressed-low-contrast.png', compressed);

  const portrait = frame(216, 384, [28, 45, 42]);
  qr(portrait, 'https://sponsor.example/offer', 18, 250, 3);
  await save('qr-sponsor-portrait-layout.png', portrait);

  const blurred = frame(384, 216, [48, 34, 55]);
  qr(blurred, 'https://sponsor.example/offer', 228, 45, 4);
  blur(blurred);
  rect(blurred, 293, 105, 9, 9, [112, 76, 89]);
  await save('qr-sponsor-blur-partial-occlusion.png', blurred);

  const generic = frame(384, 216, [33, 49, 68]);
  qr(generic, 'https://x.co/y', 268, 58, 3);
  await save('qr-generic-url-non-promotional.png', generic);

  const noisy = frame(384, 216, [41, 43, 50]);
  for (let index = 0; index < 44; index += 1) {
    rect(noisy, Math.floor(random() * 360), Math.floor(random() * 190), 2 + Math.floor(random() * 12), 2 + Math.floor(random() * 8), [180, 185, 194]);
  }
  await save('qr-hard-negative-noisy-geometry.png', noisy);
}

async function generateProgressSequence(prefix, options) {
  for (let index = 0; index < options.fills.length; index += 1) {
    const png = frame(options.width, options.height, options.palette);
    options.decorate?.(png, index);
    progress(png, options.y, options.startX, options.fills[index], options.endX, options.rows ?? 3, options.fill, options.track);
    await save(`${prefix}-${index + 1}.png`, png);
  }
}

async function generateProgressFixtures() {
  await generateProgressSequence('progress-advancing-landscape', {
    width: 384, height: 216, y: 96, startX: 42, endX: 342, fills: [126, 184, 245], palette: [25, 39, 62]
  });
  await generateProgressSequence('progress-countdown-compressed', {
    width: 480, height: 270, y: 82, startX: 55, endX: 425, fills: [360, 280, 198], palette: [55, 42, 46],
    decorate(png) { blockQuantize(png, 8, 12); }
  });
  await generateProgressSequence('progress-portrait-layout', {
    width: 216, height: 384, y: 188, startX: 20, endX: 196, fills: [72, 113, 156], palette: [28, 48, 52]
  });

  for (let index = 0; index < 3; index += 1) {
    const staticLine = frame(384, 216);
    rect(staticLine, 35, 105, 314, 3, [244, 246, 249]);
    await save(`progress-hard-negative-static-separator-${index + 1}.png`, staticLine);

    const controls = frame(384, 216);
    progress(controls, 204, 0, 95 + index * 55, 383, 3, [245, 245, 245], [82, 82, 82]);
    rect(controls, 14, 190, 14, 8, [221, 225, 230]);
    rect(controls, 348, 190, 18, 8, [221, 225, 230]);
    await save(`progress-hard-negative-youtube-controls-${index + 1}.png`, controls);

    const meter = frame(384, 216, [31, 43, 47]);
    progress(meter, 88, 64, [150, 202, 266][index], 320, 3, [244, 248, 250], [86, 92, 96]);
    for (let bar = 0; bar < 16; bar += 1) {
      rect(meter, 70 + bar * 15, 130 - ((bar * 7 + index * 11) % 42), 7, 40, [80, 156, 162]);
    }
    await save(`progress-hard-negative-moving-meter-${index + 1}.png`, meter);
  }
}

await generateQrFixtures();
await generateProgressFixtures();
