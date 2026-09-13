"use client";

import {
  Download,
  Gauge,
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "./I18n";

/**
 * 自己的视频播放条。
 *
 * 原来直接用 `<video controls>`，那是 Chrome 自带的控件：长得和软件皮肤完全
 * 两个世界，而且全屏按钮点了没反应 —— 它全屏的是 `<video>` 本身，我们的布局里
 * 视频外面套了几层带 overflow 的容器，Chromium 自带控件在这种情况下表现不稳。
 * 换成自己的：全屏由我们对着最外层 wrapper 调 requestFullscreen，倍速、下载、
 * 音量都是自己的 state，点一下就生效。
 */

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export function VideoPlayer({
  src,
  autoPlay,
  className,
  onDownload,
}: {
  src: string;
  autoPlay?: boolean;
  /** 给外层定视频本身的尺寸上限，例如 `max-h-[26rem]`。 */
  className?: string;
  onDownload?: () => void;
}) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [full, setFull] = useState(false);

  // 全屏状态要跟着浏览器走：用户按 Esc 退出时也得把图标换回来。
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFull = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrap.requestFullscreen().catch(() => undefined);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const progress = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <div
      ref={wrapRef}
      data-video-player=""
      className={`group/player relative overflow-hidden rounded-2xl bg-black ${
        full ? "flex h-full w-full items-center justify-center rounded-none" : ""
      }`}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        playsInline
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
        className={full ? "max-h-full max-w-full" : className || "max-h-[26rem] w-auto max-w-full"}
      />

      {/* 没播的时候给个大的播放键，不然一块黑的看不出是视频 */}
      {!playing ? (
        <button
          type="button"
          aria-label={t("播放")}
          onClick={togglePlay}
          className="absolute inset-0 grid place-items-center bg-black/20"
        >
          <span className="grid size-14 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
            <Play className="size-6 translate-x-0.5" />
          </span>
        </button>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-1 opacity-0 transition group-hover/player:translate-y-0 group-hover/player:opacity-100 focus-within:translate-y-0 focus-within:opacity-100">
        <div className="pointer-events-auto bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6">
          <div className="flex items-center gap-2">
            <input
              type="range"
              aria-label={t("进度")}
              min={0}
              max={duration || 0}
              step={0.1}
              value={time}
              onChange={(event) => {
                const next = Number(event.target.value);
                setTime(next);
                if (videoRef.current) videoRef.current.currentTime = next;
              }}
              style={{ backgroundSize: `${progress}% 100%` }}
              className="player-range h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/25"
            />
            <span className="shrink-0 text-[11px] tabular-nums text-white/75">
              {clock(time)} / {clock(duration)}
            </span>
          </div>

          <div className="mt-1 flex items-center gap-0.5">
            <button
              type="button"
              aria-label={playing ? t("暂停") : t("播放")}
              onClick={togglePlay}
              className="grid size-8 place-items-center rounded-lg text-white/85 hover:bg-white/15 hover:text-white"
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <button
              type="button"
              aria-label={muted ? t("取消静音") : t("静音")}
              onClick={() => {
                const video = videoRef.current;
                if (video) video.muted = !video.muted;
              }}
              className="grid size-8 place-items-center rounded-lg text-white/85 hover:bg-white/15 hover:text-white"
            >
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>

            <div className="relative ml-auto">
              {speedOpen ? (
                <div className="absolute bottom-9 right-0 overflow-hidden rounded-xl border border-white/15 bg-black/85 backdrop-blur">
                  {SPEEDS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setSpeed(value);
                        setSpeedOpen(false);
                        if (videoRef.current) videoRef.current.playbackRate = value;
                      }}
                      className={`block w-full px-3 py-1.5 text-left text-[12px] tabular-nums hover:bg-white/15 ${
                        value === speed ? "text-white" : "text-white/70"
                      }`}
                    >
                      {value}×
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                aria-label={t("播放速度")}
                onClick={() => setSpeedOpen((value) => !value)}
                className="flex h-8 items-center gap-1 rounded-lg px-2 text-white/85 hover:bg-white/15 hover:text-white"
              >
                <Gauge className="size-4" />
                <span className="text-[11px] tabular-nums">{speed}×</span>
              </button>
            </div>

            {onDownload ? (
              <button
                type="button"
                aria-label={t("下载视频")}
                onClick={onDownload}
                className="grid size-8 place-items-center rounded-lg text-white/85 hover:bg-white/15 hover:text-white"
              >
                <Download className="size-4" />
              </button>
            ) : null}
            <button
              type="button"
              aria-label={full ? t("退出全屏") : t("全屏")}
              onClick={toggleFull}
              className="grid size-8 place-items-center rounded-lg text-white/85 hover:bg-white/15 hover:text-white"
            >
              {full ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
