import './globals.css';

export const metadata = {
  title: 'Demo Todo',
  description: 'AI-native SDLC 파이프라인 시연용 데모 앱',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
