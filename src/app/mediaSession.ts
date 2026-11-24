export interface MediaSessionHandlers {
  readonly onPlay: () => void;
  readonly onStop: () => void;
}

const APP_NAME = 'Mahmoud Tesla S';

/** Maps the media player's play, pause, and stop buttons (on screen or on the wheel). */
export function bindMediaSession(handlers: MediaSessionHandlers): void {
  if (!('mediaSession' in navigator)) return;
  const actions: [MediaSessionAction, () => void][] = [
    ['play', handlers.onPlay],
    ['pause', handlers.onStop],
    ['stop', handlers.onStop],
  ];
  for (const [action, handler] of actions) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // The browser does not support this action.
    }
  }
}

/** Names the engine in the media player while it plays; `null` marks playback as paused. */
export function showNowPlaying(engineName: string | null): void {
  if (!('mediaSession' in navigator)) return;
  const session = navigator.mediaSession;
  if (engineName === null) {
    session.playbackState = 'paused';
    return;
  }
  if (typeof MediaMetadata !== 'undefined') {
    session.metadata = new MediaMetadata({
      title: engineName,
      artist: APP_NAME,
      album: 'Engine Sound',
      artwork: [{ src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    });
  }
  session.playbackState = 'playing';
}
