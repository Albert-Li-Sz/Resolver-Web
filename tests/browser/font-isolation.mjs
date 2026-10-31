import { initFonts, drawText, NAME_FONT_FAMILY } from '/js/render/text.js';
await initFonts();
const canvas = document.querySelector('canvas'), context = canvas.getContext('2d');
function render() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawText(context, '金牌 / 冠亚季军 / 首解', 20, 85, { size: 48, bold: true });
  drawText(context, '南京信息工程大学 · 中国队伍', 20, 185, { size: 44, family: NAME_FONT_FAMILY });
  return canvas.toDataURL();
}
const before = render();
await initFonts('zh-CN');
document.body.dataset.unchanged = String(before === render());
document.body.dataset.loaded = String(Array.from(document.fonts).some(face => face.family.includes('Contest Noto Sans SC') && face.status === 'loaded'));
