import { PresentationView } from '/js/render/presentation-view.js';
import { initFonts } from '/js/render/text.js';
const q = new URLSearchParams(location.search), type = q.get('type') || 'scoreboard', locale = q.get('locale') || 'en';
const canvas = document.querySelector('canvas');
canvas.width = Number(q.get('w') || 1920); canvas.height = Number(q.get('h') || 1080);
const data = await fetch('/test/fixture.json').then(r => r.json());
if (q.get('variant') === 'ended') data.clock.ended = new Date(1726371000000).toISOString();
if (q.get('variant') === 'chinese-names') for (const team of data.contest.teams) {
  team.name = team.displayName = `${team.label || team.id} · 南京信息工程大学 · 长江滚滚向东流`;
}
await initFonts(locale);
const view = new PresentationView();
const item = { type, duration: 15, text: 'Welcome to ICPC', images: ['/assets/img/icpc-logo.png'], teamId: data.contest.teams[0].id, targetTime: 1726371300000 };
if (q.get('variant') === 'queue-active') {
  data.frozen = false;
  data.contest.submissions = data.contest.submissions.slice(0, 6).map(s => ({ ...s, status: 'pending' }));
  view.render(canvas.getContext('2d'), data, item, { width: canvas.width, height: canvas.height, now: 1726371000000, elapsed: 0, restore: true, locale });
  data.contest.submissions = data.contest.submissions.map((s, i) => ({ ...s, status: ['pending', 'solved', 'failed'][i % 3] }));
}
for (let attempt = 0; attempt < 60; attempt++) {
  const ready = view.render(canvas.getContext('2d'), data, item, { width: canvas.width, height: canvas.height, now: 1726371004000, elapsed: 4000, restore: true, locale });
  const imagesReady = [...view.images.values()].every(image => image.complete);
  if (ready && imagesReady) { document.body.dataset.ready = 'true'; break; }
  await new Promise(r => setTimeout(r, 50));
}
