import { useEffect, useRef } from "react";
import type { AnyRecord } from "./types";
export function TemplateThumbnail({
  type,
  state,
}: {
  type: string;
  state: AnyRecord;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    if (["live", "resolver"].includes(type)) return;
    let view: any,
      active = true,
      timer: ReturnType<typeof setTimeout>;
    const module = "/js/render/presentation-view.js";
    const fonts = "/js/render/text.js";
    void Promise.all([
      import(/* @vite-ignore */ module),
      import(/* @vite-ignore */ fonts),
    ])
      .then(async ([{ PresentationView }, { initFonts }]) => {
        await initFonts(latest.current?.presentationLocale || "en");
        if (!active) return;
        view = new PresentationView();
        let attempts = 0;
        const draw = () => {
          if (!active) return;
          const c = canvas.current!;
          const data = latest.current?.data || {
            contest: {
              name: "",
              teams: [],
              problems: [],
              submissions: [],
              organizations: [],
              durationMs: 18000000,
            },
            standings: [],
            results: {},
            firstSolves: [],
          };
          const ready = view.render(
            c.getContext("2d"),
            data,
            {
              type,
              duration: 15,
              text: type === "message" ? "文字公告" : "",
              targetTime: Date.now() + 3600000,
            },
            {
              width: c.width,
              height: c.height,
              now: Date.now(),
              elapsed: 4000,
              restore: true,
              locale: latest.current?.presentationLocale || "en",
            },
          );
          const imagesPending = [...view.images.values()].some(
            (image: any) => !image.complete,
          );
          c.dataset.ready = String(ready && !imagesPending);
          if (++attempts < 40 && (!ready || imagesPending))
            timer = setTimeout(draw, 250);
        };
        draw();
      })
      .catch(() => {
        /* The template label remains usable while previews reconnect. */
      });
    return () => {
      active = false;
      clearTimeout(timer);
      view?.dispose();
    };
  }, [
    type,
    state?.contextId || state?.workspaceId,
    !!state?.data?.contest?.teams?.length,
    state?.presentationLocale,
  ]);
  return ["live", "resolver"].includes(type) ? (
    <div className="adapter-thumbnail">
      <span>{type === "live" ? "Live" : "Resolver"}</span>
      <small>{type === "live" ? "当前正式画面" : "当前滚榜观众画面"}</small>
    </div>
  ) : (
    <canvas ref={canvas} width={640} height={360} aria-hidden="true" />
  );
}
