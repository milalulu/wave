import { readFileSync, writeFileSync } from "fs";

const svgRaw = readFileSync("public/logo.svg", "utf8");

// Read the source geometry so replacing the brand mark cannot distort it.
const viewBox = svgRaw.match(/viewBox="([^"]+)"/)?.[1].trim().split(/\s+/).map(Number);
if (!viewBox || viewBox.length !== 4 || viewBox.some((n) => !Number.isFinite(n)) || viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error("Invalid logo viewBox");
const [originX, originY, origW, origH] = viewBox;
const size = 512;
const padding = 60;
const innerSize = size - padding * 2;
const scale = innerSize / Math.max(origW, origH);
const offsetX = padding + (innerSize - origW * scale) / 2;
const offsetY = padding + (innerSize - origH * scale) / 2;

const squareSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="transparent"/>
  <g transform="translate(${offsetX},${offsetY}) scale(${scale}) translate(${-originX},${-originY})">
    ${svgRaw.replace(/<svg[^>]*>/, "").replace(/<\/svg>/, "")}
  </g>
</svg>`;

writeFileSync("public/logo-square.svg", squareSvg);
console.log("Created public/logo-square.svg");
