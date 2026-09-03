import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/**
 * 본문은 Pretendard, 제목은 눈누기초고딕.
 * 로컬 파일로 싣는다. Google Fonts 는 렌더 때마다 네트워크를 타고,
 * 한글 폰트는 서브셋 요청이 수십 개로 쪼개져 경고까지 뜬다.
 */
export const FONT_BODY = "Pretendard";
export const FONT_TITLE = "BasicGothic";

await Promise.all([
  loadFont({
    family: FONT_BODY,
    url: staticFile("fonts/Pretendard-Regular.otf"),
    weight: "400",
  }),
  loadFont({
    family: FONT_BODY,
    url: staticFile("fonts/Pretendard-Bold.otf"),
    weight: "700",
  }),
  loadFont({
    family: FONT_BODY,
    url: staticFile("fonts/Pretendard-Light.otf"),
    weight: "300",
  }),
  loadFont({
    family: FONT_TITLE,
    url: staticFile("fonts/NoonnuBasicGothicRegular.ttf"),
    weight: "400",
  }),
]);
