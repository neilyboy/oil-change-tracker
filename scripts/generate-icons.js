#!/usr/bin/env node
/*
  Generate PWA icons from public/placeholder-vehicle.svg
  Outputs to public/icons/: icon-192.png, icon-512.png, apple-touch-icon.png
*/
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

(async () => {
  const projectRoot = path.join(__dirname, '..');
  const inputSvg = path.join(projectRoot, 'public', 'placeholder-vehicle.svg');
  const outDir = path.join(projectRoot, 'public', 'icons');
  if (!fs.existsSync(inputSvg)) {
    console.error('Input SVG not found at:', inputSvg);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const tasks = [
    { size: 192, file: 'icon-192.png' },
    { size: 512, file: 'icon-512.png' },
    { size: 180, file: 'apple-touch-icon.png' },
  ];

  try {
    await Promise.all(tasks.map(async ({ size, file }) => {
      const outPath = path.join(outDir, file);
      // Use a moderate density to avoid huge rasterization while keeping quality
      await sharp(inputSvg, { density: 96 })
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: true })
        .png()
        .toFile(outPath);
      console.log('Generated', outPath);
    }));
    console.log('All icons generated in', outDir);
  } catch (err) {
    console.error('Failed to generate icons:', err);
    process.exit(1);
  }
})();
