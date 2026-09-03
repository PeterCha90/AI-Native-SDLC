import { createRoot } from "react-dom/client";
import { Presenter } from "./Presenter";

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root 없음");
}

// StrictMode 는 쓰지 않는다. 이중 마운트가 Player 재생을 한 번 헛돌게 만든다.
createRoot(root).render(<Presenter />);
