# 固定画面夹具

`fixed.m3u8` / `fixed0.ts` 是本地 FFmpeg 生成的 SMPTE 色条：1920×1080、30fps、3 秒、无音轨。所有帧独立编码，固定 QP，避免截图落在不同运动帧。文件与解码帧哈希见 `../snapshots/provenance.json`。

重新生成（需人工检查画面后更新基线）：

```bash
docker run --rm -v "$PWD/tests/browser/media:/frames" \
  --entrypoint ffmpeg resolver-media-worker:browser-test \
  -nostdin -hide_banner -loglevel error \
  -f lavfi -i smptebars=size=1920x1080:rate=30 -t 3 \
  -c:v libx264 -preset ultrafast -profile:v baseline -pix_fmt yuv420p \
  -qp 18 -g 1 -threads 2 -an -f hls -hls_time 3 -hls_list_size 0 \
  -hls_playlist_type vod -hls_segment_filename /frames/fixed%d.ts /frames/fixed.m3u8
```

该夹具只用于画面回归。断流、重连、HLS / WebRTC 和声音由 `npm run test:media` 的真实动态发布流独立验证。
