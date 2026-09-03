import { Thumbnail } from "@remotion/player";
import React, { useEffect, useRef, useState } from "react";
import { SLIDES } from "../Deck";
import { color, font, FPS, HEIGHT, WIDTH } from "../theme";

/** 열렸을 때 기본 폭. Presenter 가 --strip 으로 같은 값을 쓴다. */
export const STRIP_W = 280;
export const STRIP_MIN = 160;
export const STRIP_MAX = 560;

/** 번호 칸 + 좌우 여백. 썸네일은 남는 만큼 가져간다. */
const CHROME_W = 54;

type Props = {
  open: boolean;
  index: number;
  width: number;
  onResize: (width: number) => void;
  onPick: (index: number) => void;
};

export const Filmstrip: React.FC<Props> = ({ open, index, width, onResize, onPick }) => {
  const active = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);

  const thumbW = width - CHROME_W;

  // 리스너를 down 핸들러 안에서 바로 건다. effect 로 미루면 리렌더 전에 온 첫 move 를 놓친다.
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);

    const move = (ev: PointerEvent) => {
      onResize(Math.min(STRIP_MAX, Math.max(STRIP_MIN, ev.clientX)));
    };
    const stop = (ev: PointerEvent) => {
      // 마지막 위치를 한 번 더 반영한다. move 가 합쳐지거나 누락돼도 놓는 자리에 맞는다.
      move(ev);
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  // 열 때마다 현재 장을 보이는 위치로. 뒤쪽 장에서 열면 스크롤 맨 위가 잡히는 걸 막는다.
  useEffect(() => {
    if (open) {
      active.current?.scrollIntoView({ block: "nearest" });
    }
  }, [open, index]);

  return (
    <div
      style={{
        position: "relative",
        width: open ? width : 0,
        flexShrink: 0,
        height: "100vh",
        overflowY: open ? "auto" : "hidden",
        overflowX: "hidden",
        backgroundColor: color.bgAlt,
        // 드래그 중에는 전환을 끈다. 켜두면 포인터보다 폭이 늦게 따라온다.
        transition: dragging ? "none" : "width 160ms ease",
      }}
    >
      {/* 컬럼이 왼쪽 끝에 붙어 있으므로 clientX 가 곧 폭이다. */}
      {open ? (
        <div
          onPointerDown={startDrag}
          style={{
            position: "fixed",
            top: 0,
            left: width - 3,
            width: 6,
            height: "100vh",
            cursor: "col-resize",
            backgroundColor: dragging ? color.accent : color.border,
            zIndex: 1,
          }}
        />
      ) : null}

      {/* 닫혀 있는 동안은 썸네일 18장을 아예 렌더하지 않는다. */}
      {open
        ? SLIDES.map((slide, i) => {
            const on = i === index;
            // 마지막 beat = 그 장의 내용이 전부 나온 상태. 썸네일은 완성된 화면이어야 한다.
            const thumbFrame = Math.round(slide.beats[slide.beats.length - 1] * FPS);

            return (
              <button
                key={slide.id}
                ref={on ? active : null}
                type="button"
                onClick={() => onPick(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width,
                  padding: "7px 12px",
                  border: "none",
                  background: on ? "#FFFFFF12" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    width: 22,
                    fontFamily: font.mono,
                    fontWeight: 700,
                    fontSize: 13,
                    color: on ? color.accent : color.textFaint,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>

                {/* pointerEvents 차단: 썸네일 내부 요소가 클릭을 가로채지 않게 한다. */}
                <div
                  style={{
                    outline: on ? `2px solid ${color.accent}` : `1px solid ${color.border}`,
                    outlineOffset: on ? -2 : -1,
                    pointerEvents: "none",
                  }}
                >
                  <Thumbnail
                    component={slide.component}
                    inputProps={{}}
                    frameToDisplay={thumbFrame}
                    durationInFrames={slide.frames}
                    fps={FPS}
                    compositionWidth={WIDTH}
                    compositionHeight={HEIGHT}
                    style={{
                      width: thumbW,
                      height: Math.round((thumbW * HEIGHT) / WIDTH),
                    }}
                  />
                </div>
              </button>
            );
          })
        : null}
    </div>
  );
};
