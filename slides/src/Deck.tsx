import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { AbsoluteFill } from "remotion";
import "./fonts";
import { color } from "./theme";

import { S01Title } from "./slides/S01Title";
import { S02Bottleneck } from "./slides/S02Bottleneck";
import { S03WhereBottleneck } from "./slides/S03WhereBottleneck";
import { S04Loop } from "./slides/S04Loop";
import { S05Stages } from "./slides/S05Stages";
import { S06Table } from "./slides/S06Table";
import { S07Artifacts } from "./slides/S07Artifacts";
import { S08Plan } from "./slides/S08Plan";
import { S09Design } from "./slides/S09Design";
import { S10Build1 } from "./slides/S10Build1";
import { S11Build2 } from "./slides/S11Build2";
import { S12Build3 } from "./slides/S12Build3";
import { S13Test1 } from "./slides/S13Test1";
import { S14Test2 } from "./slides/S14Test2";
import { S15Deploy1 } from "./slides/S15Deploy1";
import { S16Deploy2 } from "./slides/S16Deploy2";
import { S17Maintain } from "./slides/S17Maintain";
import { S18Close } from "./slides/S18Close";

/** 슬라이드 순서와 길이. Root.tsx 가 개별 컴포지션 등록에도 같은 배열을 쓴다. */
export const SLIDES = [
  { id: "S01Title", component: S01Title, frames: 270 },
  { id: "S02Bottleneck", component: S02Bottleneck, frames: 270 },
  { id: "S03WhereBottleneck", component: S03WhereBottleneck, frames: 270 },
  { id: "S04Loop", component: S04Loop, frames: 270 },
  { id: "S05Stages", component: S05Stages, frames: 270 },
  { id: "S06Table", component: S06Table, frames: 270 },
  { id: "S07Artifacts", component: S07Artifacts, frames: 270 },
  { id: "S08Plan", component: S08Plan, frames: 270 },
  { id: "S09Design", component: S09Design, frames: 270 },
  { id: "S10Build1", component: S10Build1, frames: 270 },
  { id: "S11Build2", component: S11Build2, frames: 270 },
  { id: "S12Build3", component: S12Build3, frames: 270 },
  { id: "S13Test1", component: S13Test1, frames: 270 },
  { id: "S14Test2", component: S14Test2, frames: 270 },
  { id: "S15Deploy1", component: S15Deploy1, frames: 270 },
  { id: "S16Deploy2", component: S16Deploy2, frames: 270 },
  { id: "S17Maintain", component: S17Maintain, frames: 270 },
  { id: "S18Close", component: S18Close, frames: 360 },
] as const;

const TRANSITION_FRAMES = 12;

/** 크로스페이드가 겹치는 만큼 전체 길이가 줄어든다. */
export const DECK_FRAMES =
  SLIDES.reduce((sum, s) => sum + s.frames, 0) - (SLIDES.length - 1) * TRANSITION_FRAMES;

export const Deck: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: color.bg }}>
      {/*
        TransitionSeries 는 Sequence/Transition 이 직속 자식이어야 한다.
        Fragment 로 감싸면 인식하지 못하므로 flatMap 으로 평탄한 배열을 만든다.
      */}
      <TransitionSeries>
        {SLIDES.flatMap((slide, i) => {
          const Comp = slide.component;
          const nodes = [
            <TransitionSeries.Sequence key={slide.id} durationInFrames={slide.frames} name={slide.id}>
              <Comp />
            </TransitionSeries.Sequence>,
          ];
          if (i < SLIDES.length - 1) {
            nodes.push(
              <TransitionSeries.Transition
                key={`${slide.id}-transition`}
                presentation={fade()}
                timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
              />,
            );
          }
          return nodes;
        })}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
