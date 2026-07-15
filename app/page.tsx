"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createExpresswayEngine,
  type ExpresswayEngine,
  type Telemetry,
} from "./expressway-engine";

const INITIAL_TELEMETRY: Telemetry = {
  speedKmh: 82,
  distanceKm: 0,
  routeName: "C1 都心環状線",
  sceneName: "MIDNIGHT APPROACH",
  fps: 60,
  quality: "HIGH",
};

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ExpresswayEngine | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry>(INITIAL_TELEMETRY);
  const [paused, setPaused] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [enginePrepared, setEnginePrepared] = useState(false);
  const [experienceStarted, setExperienceStarted] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = createExpresswayEngine(canvas, (nextTelemetry) => {
      setTelemetry(nextTelemetry);
      setReady(true);
    });

    engineRef.current = engine;
    setEnginePrepared(true);
    let reducedMotionFrame = 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      engine.setPaused(true);
      reducedMotionFrame = window.requestAnimationFrame(() => setPaused(true));
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      engine.setSpeedKmh(engine.getSpeedKmh() + direction * 4);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      if (reducedMotionFrame) window.cancelAnimationFrame(reducedMotionFrame);
      canvas.removeEventListener("wheel", onWheel);
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const beginExperience = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.start();
    setExperienceStarted(true);
  }, []);

  const togglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setPaused(engine.togglePaused());
  }, []);

  const adjustSpeed = useCallback((amount: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setSpeedKmh(engine.getSpeedKmh() + amount);
  }, []);

  const toggleSound = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setSoundEnabled(await engine.toggleSound());
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("button, input, select, textarea")) return;

      if (!experienceStarted && (event.code === "Space" || event.key === "Enter")) {
        event.preventDefault();
        beginExperience();
      } else if (event.code === "Space" || event.key.toLowerCase() === "p") {
        event.preventDefault();
        togglePause();
      } else if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") {
        event.preventDefault();
        adjustSpeed(5);
      } else if (
        event.key === "ArrowDown" ||
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        adjustSpeed(-5);
      } else if (event.key.toLowerCase() === "m") {
        void toggleSound();
      } else if (event.key.toLowerCase() === "f") {
        void toggleFullscreen();
      } else if (event.key.toLowerCase() === "h") {
        setHudVisible((visible) => !visible);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    adjustSpeed,
    beginExperience,
    experienceStarted,
    toggleFullscreen,
    togglePause,
    toggleSound,
  ]);

  return (
    <main
      className="drive-shell"
      data-ready={ready}
      data-started={experienceStarted}
    >
      <canvas
        ref={canvasRef}
        className="drive-canvas"
        aria-label="プロシージャル生成された深夜の東京高速道路を走行するリアルタイム映像"
        onDoubleClick={() => void toggleFullscreen()}
      >
        この映像作品を表示するには Canvas 2D に対応したブラウザが必要です。
      </canvas>

      <div className="cinema-frame" aria-hidden="true" />
      <div className="optical-noise" aria-hidden="true" />

      <section
        className={`start-screen ${experienceStarted ? "is-hidden" : ""}`}
        aria-label="映像作品の開始"
        aria-hidden={experienceStarted}
      >
        <div className="start-lockup">
          <span>GENERATIVE FILM 001</span>
          <h1>AFTER MIDNIGHT</h1>
          <p>首都高速・無限夜行</p>
        </div>
        <button
          type="button"
          className="start-button"
          onClick={beginExperience}
          disabled={!enginePrepared || experienceStarted}
          tabIndex={experienceStarted ? -1 : 0}
        >
          <span>START</span>
          <i aria-hidden="true">→</i>
        </button>
        <p className="start-note">TAP TO BEGIN · SOUND OPTIONAL</p>
      </section>

      {experienceStarted && (
        <section className={`hud ${hudVisible ? "is-visible" : "is-hidden"}`}>
        <header className="hud-header">
          <div className="title-lockup">
            <div className="route-disc" aria-hidden="true">
              C1
            </div>
            <div>
              <p className="kicker">TOKYO / 03:17</p>
              <h1>AFTER MIDNIGHT</h1>
              <p className="subtitle">首都高速・無限夜行</p>
            </div>
          </div>
          <div className="live-status">
            <span className="live-dot" />
            <span>PROCEDURAL / LIVE</span>
          </div>
        </header>

        <footer className="hud-footer">
          <div className="telemetry-panel" aria-label="走行情報">
            <div className="speed-readout">
              <strong>{Math.round(telemetry.speedKmh)}</strong>
              <span>KM/H</span>
            </div>
            <div className="route-readout">
              <span className="route-name">{telemetry.routeName}</span>
              <span className="scene-name">{telemetry.sceneName}</span>
            </div>
            <div className="distance-readout">
              <span>DIST.</span>
              <strong>{telemetry.distanceKm.toFixed(1).padStart(5, "0")} KM</strong>
            </div>
          </div>

          <nav className="drive-controls" aria-label="映像作品の操作">
            <button
              type="button"
              onClick={() => adjustSpeed(-5)}
              aria-label="速度を下げる"
              title="速度を下げる [↓]"
            >
              <span aria-hidden="true">−</span>
            </button>
            <button
              type="button"
              onClick={togglePause}
              aria-label={paused ? "走行を再開" : "走行を一時停止"}
              aria-pressed={paused}
              title="一時停止 / 再開 [Space]"
              className="primary-control"
            >
              <span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>
            </button>
            <button
              type="button"
              onClick={() => adjustSpeed(5)}
              aria-label="速度を上げる"
              title="速度を上げる [↑]"
            >
              <span aria-hidden="true">＋</span>
            </button>
            <span className="control-divider" aria-hidden="true" />
            <button
              type="button"
              onClick={() => void toggleSound()}
              aria-label={
                soundEnabled ? "環境音をミュート" : "環境音を有効にする"
              }
              aria-pressed={soundEnabled}
              title="環境音 [M]"
            >
              <span aria-hidden="true">{soundEnabled ? "◖))" : "◖×"}</span>
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label="フルスクリーン表示"
              title="フルスクリーン [F]"
            >
              <span aria-hidden="true">⌗</span>
            </button>
            <button
              type="button"
              onClick={() => setHudVisible(false)}
              aria-label="インターフェースを隠す"
              title="UIを隠す [H]"
            >
              <span aria-hidden="true">HUD</span>
            </button>
          </nav>
        </footer>
        </section>
      )}

      {experienceStarted && !hudVisible && (
        <button
          type="button"
          className="restore-hud"
          onClick={() => setHudVisible(true)}
          aria-label="インターフェースを表示"
        >
          HUD
        </button>
      )}

      {experienceStarted && (
        <div className="startup-title" aria-hidden="true">
          <span>GENERATIVE FILM 001</span>
          <strong>首都、深夜環状。</strong>
          <i />
        </div>
      )}

      {experienceStarted && (
        <p className="keyboard-hint" aria-hidden="true">
          SPACE 一時停止　·　↑↓ 速度　·　M 環境音　·　F 全画面
        </p>
      )}
    </main>
  );
}
