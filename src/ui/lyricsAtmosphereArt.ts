import type { SceneEvent } from "./lyricsAtmosphere";

const wrap = (value: number) => value - Math.floor(value);
const ease = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};
const noise = (seed: number) => {
  let value = seed;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) | 0;
    return (value >>> 0) / 4294967296;
  };
};

export function paintAtmosphere(ctx: CanvasRenderingContext2D, width: number, height: number, event: SceneEvent, position: number) {
  const t = position - event.time;
  const opacity = ease(t / .64) * ease((event.end - position) / 1.3);
  const random = noise(event.seed);
  const variation = event.variant / 5;
  const mobile = width < 480;
  const right = .71 + variation * .17;

  function glow(x: number, y: number, radius: number, rgb: string, amount: number) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${rgb},${amount * opacity})`);
    gradient.addColorStop(.42, `rgba(${rgb},${amount * opacity * .33})`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  switch (event.kind) {
    case "storm":
    case "rain": {
      const storm = event.kind === "storm";
      const slant = .12 + variation * .26 + (storm ? .24 : 0);
      ctx.globalAlpha = .82 * opacity;
      const tint = ctx.createLinearGradient(0, 0, width, height);
      tint.addColorStop(0, "#688fc61a");
      tint.addColorStop(.56, "#99d3ff");
      tint.addColorStop(1, storm ? "#c9a5fd8c" : "#74c3ed8c");
      ctx.strokeStyle = tint;
      ctx.lineCap = "round";
      for (let i = 0; i < (mobile ? 34 : 74); i++) {
        const depth = random();
        const y = wrap(random() + t * (.49 + depth * .72 + (storm ? .23 : 0))) * (height + 100) - 50;
        const x = wrap(random() + y / width * slant) * width;
        const length = (14 + depth * 42) * (mobile ? .72 : 1);
        ctx.globalAlpha = opacity * (.11 + depth * .38);
        ctx.lineWidth = .6 + depth * 1.05;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - length * slant, y - length);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      glow(width * right, height * .19, Math.max(width, height) * .74, storm ? "105,87,222" : "66,138,220", .39);
      if (storm) {
        const flash = Math.max(0, 1 - Math.abs(t - 1.05 - variation * .25) / .30) * opacity;
        if (flash > 0) {
          const x = width * right;
          glow(x, height * .1, Math.max(width, height) * .74, "200,180,255", flash * .54);
          ctx.globalAlpha = flash * .65;
          ctx.strokeStyle = "#f0e7ff";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(x, -10);
          ctx.lineTo(x - width * .12, height * .18);
          ctx.lineTo(x - width * .045, height * .15);
          ctx.lineTo(x - width * .16, height * .43);
          ctx.stroke();
        }
      }
      break;
    }
    case "snow": {
      glow(width * right, height * .27, Math.max(width, height) * .74, "148,184,241", .33);
      for (let i = 0; i < (mobile ? 27 : 52); i++) {
        const depth = random();
        const y = wrap(random() + t * (.085 + depth * .15)) * (height + 28) - 14;
        const x = wrap(random() + Math.sin(t * (1.1 + depth) + i) * (.022 + variation * .032) + t * variation * .021) * width;
        const r = .9 + depth * depth * (mobile ? 4 : 6.5);
        ctx.globalAlpha = opacity * (.21 + depth * .55);
        ctx.fillStyle = depth > .7 ? "#e7f8ff" : "#a7bfea";
        ctx.strokeStyle = "#e7f8ff";
        ctx.lineWidth = .75;
        ctx.beginPath();
        if (r < 3.5 || i % 2 === 0) {
          ctx.arc(x, y, r * .64, 0, Math.PI * 2);
          ctx.fill();
        } else {
          for (let arm = 0; arm < 6; arm++) {
            const a = arm * Math.PI / 3 + t * .65 + i;
            const dx = Math.cos(a) * r;
            const dy = Math.sin(a) * r;
            ctx.moveTo(x, y);
            ctx.lineTo(x + dx, y + dy);
            ctx.moveTo(x + dx * .73 - dy * .25, y + dy * .73 + dx * .25);
            ctx.lineTo(x + dx * .59, y + dy * .59);
            ctx.lineTo(x + dx * .73 + dy * .25, y + dy * .73 - dx * .25);
          }
          ctx.stroke();
        }
      }
      break;
    }
    case "ocean":
    case "dawn": {
      const sea = event.kind === "ocean";
      const horizon = height * (sea ? .73 : .68);
      const r = Math.max(width, height);
      const palette = sea ? "49,190,190" : "239,109,103";
      glow(width * right, horizon, r * .77, palette, .48);
      glow(width * right, horizon - height * .08, r * .34, sea ? "153,227,219" : "252,178,104", .39);
      if (!sea) {
        const sun = Math.min(width, height) * (.072 + variation * .05);
        ctx.globalAlpha = opacity * .69;
        const disk = ctx.createLinearGradient(0, horizon - sun * 2, 0, horizon + sun);
        disk.addColorStop(0, "#ffe4b6");
        disk.addColorStop(.48, "#ffa987e8");
        disk.addColorStop(.86, "#eb6c8f00");
        ctx.fillStyle = disk;
        ctx.beginPath();
        ctx.arc(width * right, horizon - sun * (.22 + t * .15), sun, 0, 2 * Math.PI);
        ctx.fill();
      }
      const waves = sea ? 9 : 5;
      for (let layer = 0; layer < waves; layer++) {
        const base = horizon + layer * height * .032;
        const stroke = ctx.createLinearGradient(0, base, width, base);
        stroke.addColorStop(0, "#00000000");
        stroke.addColorStop(.68, sea ? "#8aebe5cb" : "#ffab8d9e");
        stroke.addColorStop(1, "#00000000");
        ctx.strokeStyle = stroke;
        ctx.globalAlpha = opacity * (.66 - layer * .045);
        ctx.lineWidth = .7 + layer * .20;
        ctx.beginPath();
        for (let x = 0; x <= width + 6; x += 6) {
          const y = base + Math.sin(x / width * (8 + variation * 3) - t * (sea ? 2.4 : .62) + layer * .57) * (sea ? 5 + layer * 1.3 : 2 + layer);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case "embers":
    case "cosmos": {
      const space = event.kind === "cosmos";
      const radius = Math.max(width, height);
      glow(width * right, height * (space ? .31 : .93), radius * .76, space ? "98,72,224" : "232,77,44", .39);
      glow(width * (right - .13), height * (space ? .40 : .88), radius * .34, space ? "215,110,204" : "255,167,65", .34);
      for (let i = 0; i < (mobile ? 28 : 53); i++) {
        const depth = random();
        const rise = random();
        const y = (space ? wrap(rise - t * depth * .021) : 1 - wrap(rise + t * (.12 + depth * .28))) * height;
        const x = wrap(random() + Math.sin(i + t * (space ? .3 : 2)) * (.01 + variation * .035)) * width;
        const size = .60 + depth * (space ? 2.3 : 2.6);
        ctx.globalAlpha = opacity * (.19 + .50 * depth) * (.67 + .33 * Math.sin(t * 4.8 + i));
        ctx.fillStyle = space ? (i % 3 ? "#d5d7ff" : "#ffd8f0") : (i % 3 ? "#ffad61" : "#ffeabd");
        ctx.beginPath();
        ctx.arc(x, y, size, 0, 2 * Math.PI);
        ctx.fill();
        if (size > 2.3 && i % 4 === 0) {
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = .65;
          ctx.beginPath();
          ctx.moveTo(x, y - size * 2.5);
          ctx.lineTo(x, y + size * 2.5);
          ctx.moveTo(x - size * 1.7, y);
          ctx.lineTo(x + size * 1.7, y);
          ctx.stroke();
        }
      }
      break;
    }
    case "fog":
      for (let i = 0; i < 8; i++) {
        const offset = random();
        const x = (offset + Math.sin(t * .58 + i) * .12) * width;
        const y = height * (.57 + random() * .47);
        glow(x, y, Math.max(width, height) * (.16 + random() * .22), i % 2 ? "142,121,184" : "122,150,201", .16);
      }
      break;
    case "leaves":
      glow(width * right, height * .73, Math.max(width, height) * .74, "217,118,74", .24);
      for (let i = 0; i < (mobile ? 12 : 22); i++) {
        const depth = random();
        const y = wrap(random() + t * (.09 + depth * .13)) * height;
        const x = wrap(random() + t * (.045 + variation * .05) + Math.sin(t * 1.4 + i) * .047) * width;
        const size = (mobile ? 5 : 7) + depth * 6.5;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(i + t * (1.1 + depth));
        ctx.scale(.43 + Math.abs(Math.sin(t * 2 + i)) * .56, 1);
        ctx.globalAlpha = opacity * (.29 + depth * .42);
        ctx.fillStyle = ["#e2a176", "#bf6d95", "#f2ce86"][i % 3];
        ctx.beginPath();
        ctx.moveTo(-size * .65, 0);
        ctx.quadraticCurveTo(0, -size, size, -size * .41);
        ctx.quadraticCurveTo(size * .60, size * .67, -size * .65, 0);
        ctx.fill();
        ctx.restore();
      }
  }
  ctx.globalAlpha = 1;
}
