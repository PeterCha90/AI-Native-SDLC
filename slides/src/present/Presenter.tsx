import { Player, PlayerRef } from "@remotion/player";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { SLIDES } from "../Deck";
import "../fonts";
import { color, font, FPS, HEIGHT, size, WIDTH } from "../theme";
import { Filmstrip, STRIP_W } from "./Filmstrip";

/**
 * 발표 모드.
 *
 * 슬라이드의 실제 타임라인을 그대로 재생하되, Deck.tsx 가 선언한 beat 프레임에서 멈춘다.
 * 그래서 차트가 자라나는 것 같은 긴 애니메이션도 원본 그대로 보이고,
 * 발표자는 의미 단위로 끊어 말할 수 있다.
 *
 * 앞으로 갈 때는 재생해서 다음 beat 에 서고, 뒤로 갈 때는 그 beat 프레임으로 바로 이동한다.
 * 뒤로 갈 때 굳이 다시 재생하면 방금 한 말을 되감는 꼴이라 즉시 이동이 낫다.
 */

const beatFrame = (slideIndex: number, beatIndex: number) =>
  Math.round(SLIDES[slideIndex].beats[beatIndex] * FPS);

export const Presenter: React.FC = () => {
  const [index, setIndex] = useState(0);
  const [beat, setBeat] = useState(0);
  const [hint, setHint] = useState(true);
  const [strip, setStrip] = useState(false);
  const [stripW, setStripW] = useState(STRIP_W);

  const player = useRef<PlayerRef>(null);
  /** frameupdate 핸들러가 볼 목표 프레임. state 로 두면 닫힌 값이 낡는다. */
  const target = useRef(0);
  /**
   * 다음 위치로 갈 때 재생할지 즉시 이동할지.
   * 이동은 반드시 렌더 이후(effect)에 해야 한다. 장을 바꾸면 Player 가 리마운트되는데,
   * 핸들러 안에서 바로 seek 하면 아직 이전 인스턴스의 ref 를 잡는다.
   */
  const nav = useRef<"play" | "snap">("snap");

  const slide = SLIDES[index];

  /** 재생 없이 그 프레임의 화면으로 바로 간다. */
  const snapTo = useCallback((frame: number) => {
    const p = player.current;
    if (!p) {
      return;
    }
    target.current = frame;
    p.pause();
    p.seekTo(frame);
  }, []);

  /** 지금 위치에서 목표 프레임까지 재생하고 선다. */
  const playTo = useCallback((frame: number) => {
    const p = player.current;
    if (!p) {
      return;
    }
    target.current = frame;
    if (p.getCurrentFrame() >= frame) {
      p.seekTo(frame);
      return;
    }
    p.play();
  }, []);

  // 목표에 닿으면 세운다. 목표는 ref 라 리스너를 다시 걸 필요가 없다.
  useEffect(() => {
    const p = player.current;
    if (!p) {
      return;
    }
    const stop = () => {
      if (p.getCurrentFrame() >= target.current) {
        p.pause();
        p.seekTo(target.current);
      }
    };
    p.addEventListener("frameupdate", stop);
    return () => p.removeEventListener("frameupdate", stop);
  }, []);

  // 위치 이동은 여기 한 곳에서만 일어난다. 렌더가 끝난 뒤라 Player 가 항상 준비돼 있다.
  useEffect(() => {
    const frame = beatFrame(index, beat);
    if (nav.current === "play") {
      playTo(frame);
    } else {
      snapTo(frame);
    }
  }, [index, beat, playTo, snapTo]);

  const go = useCallback(
    (dir: 1 | -1) => {
      setHint(false);

      const nextBeat = beat + dir;

      if (nextBeat >= 0 && nextBeat < slide.beats.length) {
        // 앞으로는 재생해서 보여주고, 뒤로는 즉시 되돌린다.
        // 뒤로 가면서 다시 재생하면 방금 한 설명을 되감는 꼴이 된다.
        nav.current = dir === 1 ? "play" : "snap";
        setBeat(nextBeat);
        return;
      }

      const nextIndex = index + dir;
      if (nextIndex < 0 || nextIndex >= SLIDES.length) {
        return;
      }

      // 앞으로 넘어가면 그 장의 처음, 뒤로 넘어가면 그 장의 마지막 상태로 들어간다.
      nav.current = "snap";
      setIndex(nextIndex);
      setBeat(dir === 1 ? 0 : SLIDES[nextIndex].beats.length - 1);
    },
    [beat, index, slide.beats.length],
  );

  const jump = useCallback((nextIndex: number) => {
    setHint(false);
    // 목차에서 고르면 그 장이 다 나온 상태로 간다. 거기서 뒤로 짚어갈 수 있다.
    nav.current = "snap";
    setIndex(nextIndex);
    setBeat(SLIDES[nextIndex].beats.length - 1);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key;

      if (key === "ArrowRight" || key === "ArrowDown" || key === " " || key === "PageDown") {
        e.preventDefault();
        go(1);
      } else if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") {
        e.preventDefault();
        go(-1);
      } else if (key === "Home") {
        e.preventDefault();
        nav.current = "snap";
        setIndex(0);
        setBeat(0);
      } else if (key === "End") {
        e.preventDefault();
        jump(SLIDES.length - 1);
      } else if (e.code === "KeyS") {
        // key 가 아니라 code 로 본다. 한글 입력 상태에서도 같은 자리가 먹는다.
        e.preventDefault();
        setStrip((v) => !v);
        setHint(false);
      } else if (key === "Escape") {
        setStrip(false);
      } else if (e.code === "KeyF") {
        e.preventDefault();
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else {
          void document.documentElement.requestFullscreen();
        }
      } else if (e.code === "KeyR") {
        // 방금 구간을 다시 보여주고 싶을 때. 이전 beat 로 되돌린 뒤 다시 재생한다.
        e.preventDefault();
        const from = beat > 0 ? beatFrame(index, beat - 1) : 0;
        snapTo(from);
        window.requestAnimationFrame(() => playTo(beatFrame(index, beat)));
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, jump, snapTo, playTo, beat, index]);

  return (
    <div
      style={
        {
          // 컬럼이 차지한 만큼 슬라이드가 좁아진다. 겹쳐서 가리지 않기 위한 값 하나.
          "--strip": `${strip ? stripW : 0}px`,
          width: "100vw",
          height: "100vh",
          backgroundColor: color.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        } as React.CSSProperties
      }
    >
      <Filmstrip open={strip} index={index} width={stripW} onResize={setStripW} onPick={jump} />

      <Player
        ref={player}
        // key 로 장을 바꾼다. Player 내부 프레임 상태가 이전 장 값을 물고 오지 않는다.
        key={slide.id}
        component={slide.component}
        inputProps={{}}
        // 리마운트 직후 첫 프레임부터 목표 위치를 그린다. 장 전환에 번쩍임이 없다.
        initialFrame={beatFrame(index, beat)}
        durationInFrames={slide.frames}
        fps={FPS}
        compositionWidth={WIDTH}
        compositionHeight={HEIGHT}
        controls={false}
        clickToPlay={false}
        doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false}
        style={{
          flexShrink: 0,
          width: "min(calc(100vw - var(--strip)), 177.78vh)",
          height: "min(calc((100vw - var(--strip)) * 0.5625), 100vh)",
        }}
      />

      {/* 진행 막대. 장 단위가 아니라 beat 단위로 차서 남은 분량이 실제 호흡과 맞는다. */}
      <div
        style={{
          position: "fixed",
          left: 0,
          bottom: 0,
          height: 3,
          width: `${((index + (beat + 1) / slide.beats.length) / SLIDES.length) * 100}%`,
          backgroundColor: color.accent,
        }}
      />

      <div
        style={{
          position: "fixed",
          right: 18,
          bottom: 14,
          fontFamily: font.mono,
          fontSize: 13,
          color: color.textFaint,
        }}
      >
        {String(index + 1).padStart(2, "0")} / {SLIDES.length} · {beat + 1}/{slide.beats.length}
      </div>

      <button
        type="button"
        onClick={() => {
          setStrip((v) => !v);
          setHint(false);
        }}
        style={{
          position: "fixed",
          left: "calc(var(--strip) + 14px)",
          bottom: 14,
          padding: "6px 12px",
          border: "none",
          borderRadius: 4,
          background: "rgba(255,255,255,0.08)",
          color: color.textDim,
          fontFamily: font.mono,
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: "0.12em",
          cursor: "pointer",
        }}
      >
        {strip ? "닫기" : "목차"}
      </button>

      {hint ? (
        <div
          style={{
            position: "fixed",
            right: 22,
            bottom: 44,
            padding: "12px 18px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.08)",
            color: color.text,
            fontSize: size.tiny - 6,
            fontFamily: font.sans,
            lineHeight: 1.7,
          }}
        >
          → / Space 다음 · ← 이전 · S 목차 · F 전체화면 · R 다시 · Home·End 처음·끝
        </div>
      ) : null}
    </div>
  );
};
