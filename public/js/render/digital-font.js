/* Port of ICPC Tools v2.6.1331 DigitalFont. See /licenses/icpc-tools.txt. */
const polygons = [
  [
    [6779, -10204],
    [5700, -9111],
    [2157, -9111],
    [1079, -10204],
  ],
  [
    [874, -5714],
    [874, -10000],
    [1968, -8907],
    [1968, -5991],
    [1283, -5306],
  ],
  [
    [5904, -5991],
    [5904, -8907],
    [6983, -10000],
    [6983, -5714],
    [6589, -5306],
  ],
  [
    [5831, -5642],
    [6371, -5102],
    [5831, -4562],
    [2026, -4562],
    [1486, -5102],
    [2026, -5642],
  ],
  [
    [1968, -4213],
    [1968, -1297],
    [874, -204],
    [874, -4475],
    [1283, -4898],
  ],
  [
    [6983, -4475],
    [6983, -204],
    [5904, -1297],
    [5904, -4213],
    [6589, -4898],
  ],
  [
    [6779, 0],
    [1079, 0],
    [2157, -1093],
    [5700, -1093],
  ],
  [
    [1210, -7406],
    [1210, -8499],
    [2303, -8499],
    [2303, -7406],
  ],
  [
    [1210, -1501],
    [1210, -2491],
    [2303, -2491],
    [2303, -1501],
  ],
  [
    [5219, -5642],
    [5758, -5102],
    [5219, -4562],
    [1414, -4562],
    [874, -5102],
    [1414, -5642],
  ],
  [
    [3863, -5845],
    [3324, -5306],
    [2770, -5845],
    [2770, -6997],
    [3324, -7551],
    [3863, -6997],
  ],
  [
    [5758, -5102],
    [5219, -4562],
    [4067, -4562],
    [3513, -5102],
    [4067, -5642],
    [5219, -5642],
  ],
  [
    [3119, -5102],
    [2566, -4562],
    [1414, -4562],
    [874, -5102],
    [1414, -5642],
    [2566, -5642],
  ],
  [
    [3863, -3193],
    [3324, -2653],
    [2770, -3193],
    [2770, -4359],
    [3324, -4898],
    [3863, -4359],
  ],
];
const digits = [
  [1, 1, 1, 0, 1, 1, 1],
  [0, 0, 1, 0, 0, 1, 0],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 0, 1, 1],
  [0, 1, 1, 1, 0, 1, 0],
  [1, 1, 0, 1, 0, 1, 1],
  [1, 1, 0, 1, 1, 1, 1],
  [1, 0, 1, 0, 0, 1, 0],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 0, 1, 0],
];
export function digitalWidth(value, height) {
  let width = 876 * (value.length - 1);
  for (const c of value)
    width += /\d/.test(c)
      ? 6109
      : c === ":" || c === "."
        ? 1092
        : c === "-" || c === "+"
          ? 4884
          : 0;
  return Math.trunc((width * height) / 10240);
}
export function drawDigital(
  ctx,
  value,
  x,
  y,
  height,
  foreground = "#fff",
  background = "#0c0c0c",
) {
  ctx.save();
  ctx.translate(x, y);
  const scale = Math.fround(height / 10240);
  ctx.scale(scale, scale);
  const polygon = (index, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    polygons[index].forEach(([px, py], i) =>
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py),
    );
    ctx.closePath();
    ctx.fill();
  };
  for (const c of value) {
    ctx.translate(-874, 0);
    if (/\d/.test(c)) {
      digits[Number(c)].forEach((on, i) => {
        if (on || background) polygon(i, on ? foreground : background);
      });
      ctx.translate(6109, 0);
    } else if (c === ":" || c === ".") {
      if (c === ":") polygon(7, foreground);
      polygon(8, foreground);
      ctx.translate(1092, 0);
    } else if (c === "-") {
      polygon(9, foreground);
      ctx.translate(4884, 0);
    } else if (c === "+") {
      for (let i = 10; i < 14; i++) polygon(i, foreground);
      ctx.translate(4884, 0);
    }
    ctx.translate(1750, 0);
  }
  ctx.restore();
}
