import { readFileSync, writeFileSync } from "fs";

const svgRaw = readFileSync("public/logo.svg", "utf8");

// Original viewBox: 0 0 2098 1392
const origW = 2098;
const origH = 1392;
const size = 512;
const padding = 60;
const innerSize = size - padding * 2;
const scale = innerSize / Math.max(origW, origH);
const offsetX = padding + (innerSize - origW * scale) / 2;
const offsetY = padding + (innerH = innerSize - origH * scale) / 2;

const squareSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="transparent"/>
  <g transform="translate(${offsetX},${offsetY}) scale(${scale})">
    ${svgRaw.replace(/<svg[^>]*>/, "").replace(/<\/svg>/, "")}
  </g>
</svg>`;

writeFileSync("public/logo-square.svg", squareSvg);
console.log("Created public/logo-square.svg");
