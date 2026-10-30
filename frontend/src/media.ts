import { api } from "./api";
type Playback = { user: string; password: string; whep: string; hls: string };
export class MediaReader {
  video = document.createElement("video");
  private readerId = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  private pc: RTCPeerConnection | null = null;
  private auth = "";
  private info: Playback | null = null;
  private closeHls: (() => void) | null = null;
  private closed = false;
  private generation = 0;
  private hlsStarting = false;
  private location: string | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private failTimer: ReturnType<typeof setTimeout> | undefined;
  private lease: ReturnType<typeof setInterval>;
  private watchdog: ReturnType<typeof setInterval>;
  private lastTime = -1;
  private lastFrame = 0;
  get ready() {
    return this.video.readyState >= 2 && Date.now() - this.lastFrame < 6000;
  }
  constructor(
    public id: string,
    public headers: Record<string, string>,
    public onFailure?: () => void,
  ) {
    this.video.playsInline = true;
    this.video.crossOrigin = "anonymous";
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.addEventListener("error", () => this.reconnect());
    void this.connect();
    // One lease per reader; refresh credentials without reloading a healthy HLS stream.
    this.lease = setInterval(
      () => void this.authorize().catch(() => this.onFailure?.()),
      30000,
    );
    this.watchdog = setInterval(() => {
      if (
        this.video.currentTime !== this.lastTime &&
        this.video.readyState >= 2
      ) {
        this.lastTime = this.video.currentTime;
        this.lastFrame = Date.now();
      } else if (this.lastFrame && Date.now() - this.lastFrame > 6000)
        this.reconnect();
    }, 1000);
  }
  private async authorize() {
    const info: Playback = await api(
      `/media/${this.headers["X-Media-Preview"] ? "preview-read" : "read"}/${this.id}`,
      { readerId: this.readerId },
      "POST",
      this.headers,
    );
    if (!this.closed) {
      this.info = info;
      this.auth = `Basic ${btoa(`${info.user}:${info.password}`)}`;
    }
    return info;
  }
  private release() {
    this.pc && (this.pc.onconnectionstatechange = null);
    this.pc?.close();
    this.pc = null;
    clearTimeout(this.failTimer);
    this.closeHls?.();
    this.closeHls = null;
    this.hlsStarting = false;
    this.video.pause();
    this.video.srcObject = null;
    this.video.removeAttribute("src");
    this.video.load();
    if (this.location)
      void fetch(this.location, {
        method: "DELETE",
        headers: { Authorization: this.auth },
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    this.location = null;
  }
  private reconnect() {
    if (this.closed || this.retry) return;
    this.onFailure?.();
    this.lastFrame = 0;
    this.generation++;
    this.release();
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.connect();
    }, 2500);
  }
  private async connect() {
    const generation = ++this.generation;
    try {
      const info = await this.authorize();
      if (this.closed || generation !== this.generation) return;
      try {
        const pc = new RTCPeerConnection();
        this.pc = pc;
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });
        const inbound = new MediaStream();
        pc.ontrack = (e) => {
          if (this.closed || generation !== this.generation) return;
          if (!inbound.getTrackById(e.track.id)) inbound.addTrack(e.track);
          this.video.srcObject = inbound;
          void this.video.play().catch(() => {});
        };
        pc.onconnectionstatechange = () => {
          if (["failed", "disconnected"].includes(pc.connectionState))
            void this.hls(info, generation);
        };
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === "complete") return resolve();
          const t = setTimeout(resolve, 1500);
          pc.addEventListener("icegatheringstatechange", () => {
            if (pc.iceGatheringState === "complete") {
              clearTimeout(t);
              resolve();
            }
          });
        });
        if (this.closed || generation !== this.generation) return;
        const r = await fetch(info.whep, {
          method: "POST",
          headers: {
            "Content-Type": "application/sdp",
            Authorization: this.auth,
          },
          body: pc.localDescription!.sdp,
          signal: AbortSignal.timeout(4000),
        });
        if (!r.ok) throw Error();
        const location = new URL(
          r.headers.get("Location") || info.whep,
          info.whep,
        ).href;
        if (this.closed || generation !== this.generation) {
          void fetch(location, {
            method: "DELETE",
            headers: { Authorization: this.auth },
          }).catch(() => {});
          return;
        }
        this.location = location;
        await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
        this.failTimer = setTimeout(() => {
          if (!this.ready) void this.hls(info, generation);
        }, 7000);
      } catch {
        await this.hls(info, generation);
      }
    } catch {
      this.reconnect();
    }
  }
  private async hls(info: Playback, generation: number) {
    if (
      this.closed ||
      generation !== this.generation ||
      this.closeHls ||
      this.hlsStarting
    )
      return;
    this.hlsStarting = true;
    this.pc && (this.pc.onconnectionstatechange = null);
    this.pc?.close();
    this.pc = null;
    clearTimeout(this.failTimer);
    this.video.srcObject = null;
    try {
      const Hls = (await import("hls.js")).default;
      if (this.closed || generation !== this.generation) return;
      if (!Hls.isSupported()) throw Error("HLS unavailable");
      const hls = new Hls({
        xhrSetup: (x) => x.setRequestHeader("Authorization", this.auth),
        maxBufferLength: 5,
      });
      this.closeHls = () => hls.destroy();
      hls.attachMedia(this.video);
      hls.loadSource(info.hls);
      hls.on(
        Hls.Events.MANIFEST_PARSED,
        () => void this.video.play().catch(() => {}),
      );
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) this.reconnect();
      });
    } catch {
      this.reconnect();
    } finally {
      this.hlsStarting = false;
    }
  }
  audio(volume: number, muted: boolean) {
    this.video.muted = muted || !volume;
    this.video.volume = volume;
    if (!this.video.muted && this.video.paused)
      void this.video.play().catch(() => {});
  }
  close() {
    this.closed = true;
    this.generation++;
    clearInterval(this.lease);
    clearInterval(this.watchdog);
    clearTimeout(this.retry);
    this.release();
    void api(
      `/media/${this.headers["X-Media-Preview"] ? "preview-read" : "read"}/${this.id}`,
      { readerId: this.readerId, release: true },
      "POST",
      this.headers,
    ).catch(() => {});
  }
}
