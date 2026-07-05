export function observeLocationChanges(onChange: (url: URL) => void): () => void {
  let current = location.href;
  const interval = window.setInterval(() => {
    if (location.href === current) return;
    current = location.href;
    onChange(new URL(current));
  }, 500);

  window.addEventListener('yt-navigate-finish', handleYouTubeNavigate);

  function handleYouTubeNavigate(): void {
    if (location.href === current) return;
    current = location.href;
    onChange(new URL(current));
  }

  return () => {
    window.clearInterval(interval);
    window.removeEventListener('yt-navigate-finish', handleYouTubeNavigate);
  };
}
