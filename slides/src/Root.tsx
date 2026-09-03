import "./index.css";
import "./fonts";
import { Composition, Folder } from "remotion";
import { Deck, DECK_FRAMES, SLIDES } from "./Deck";
import { FPS, HEIGHT, WIDTH } from "./theme";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* 개별 슬라이드. Studio 에서 한 장씩 열어 편집하거나 스틸로 뽑을 수 있다. */}
      <Folder name="Slides">
        {SLIDES.map((slide) => (
          <Composition
            key={slide.id}
            id={slide.id}
            component={slide.component}
            durationInFrames={slide.frames}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
          />
        ))}
      </Folder>

      <Composition
        id="Deck"
        component={Deck}
        durationInFrames={DECK_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    </>
  );
};
