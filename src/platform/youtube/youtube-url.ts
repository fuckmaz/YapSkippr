export function isYouTubeWatchUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'youtu.be') return url.pathname.length > 1;
  return (hostname === 'youtube.com' || hostname.endsWith('.youtube.com'))
    && url.pathname === '/watch'
    && url.searchParams.has('v');
}

export function getYouTubeVideoIdFromUrl(url: URL): string | null {
  if (url.hostname.toLowerCase() === 'youtu.be') {
    return decodeURIComponent(url.pathname.slice(1).split('/')[0] ?? '') || null;
  }
  return url.searchParams.get('v');
}
