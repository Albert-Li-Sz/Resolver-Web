// Test-only publisher. No ports are exposed outside the isolated Compose network.
import http from 'node:http';
import { spawn } from 'node:child_process';
let child = null;
async function stop() {
  if (!child) return;
  const old = child; child = null;
  old.kill('SIGTERM');
  await new Promise(resolve => { old.once('exit', resolve); setTimeout(() => { old.kill('SIGKILL'); resolve(); }, 2000).unref(); });
}
http.createServer(async (req, res) => {
  try {
    if (req.url === '/health') return res.end('ok');
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    if (req.url === '/stop') { await stop(); res.end('stopped'); return; }
    if (req.url !== '/start') { res.writeHead(404).end(); return; }
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 4096) throw Error(); }
    const { url } = JSON.parse(body), target = new URL(url);
    if (target.protocol !== 'rtsp:' || target.hostname !== 'mediamtx' || !/^\/source-[a-f0-9]{32}$/.test(target.pathname)) throw Error();
    await stop();
    child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', '30', '-threads', '2', '-c:a', 'aac', '-f', 'rtsp', '-rtsp_transport', 'tcp', url], { stdio: 'ignore' });
    child.on('error', () => {});
    res.end('started');
  } catch { res.writeHead(400).end('Invalid fixture operation'); }
}).listen(8092, '0.0.0.0');
process.on('SIGTERM', () => void stop().then(() => process.exit()));
