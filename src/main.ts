import { EngineController } from './app/controller';
import { bindMediaSession, showNowPlaying } from './app/mediaSession';
import { ScreenWakeLock } from './app/wakeLock';
import { DEFAULT_PROFILE, findProfile, PROFILES } from './engine/profiles';
import { EngineSynth } from './engine/synth';
import { registerServiceWorker } from './pwa';
import { GpsSpeedSource } from './speed/gpsSource';
import { defaultSettings, loadSettings, type Settings, saveSettings } from './storage/settings';
import { createView } from './ui/view';

/** The crackle slider's midpoint plays each engine's own amount of pops. */
const CRACKLE_MIDPOINT = 50;
/** Commit the deployed build came from, shown in Diagnostics; local builds show "dev". */
const APP_VERSION = import.meta.env.VITE_APP_VERSION?.slice(0, 7) || 'dev';

const storage = getLocalStorage();
let settings: Settings = loadSettings(
  storage,
  PROFILES.map((profile) => profile.id),
  defaultSettings(DEFAULT_PROFILE.id),
);
const initialProfile = findProfile(settings.engineId);
let currentProfile = initialProfile;
let powering = false;
const synth = new EngineSynth(initialProfile);
const wakeLock = new ScreenWakeLock();

const view = createView(
  document,
  PROFILES,
  {
    onPower: () => void togglePower(),
    onRev: (held) => controller.setRev(held),
    onPedal: (pedal, held) => controller.setPedal(pedal, held),
    onEngine: (id) => {
      currentProfile = findProfile(id);
      controller.setProfile(currentProfile);
      view.selectEngine(currentProfile);
      if (controller.running) showNowPlaying(currentProfile.name);
      persist({ engineId: currentProfile.id });
    },
    onMode: (mode) => controller.setMode(mode),
    onVolume: (percent, committed) => {
      synth.setVolume(percent / 100);
      if (committed) persist({ volume: percent });
    },
    onMute: () => {
      synth.setMuted(!synth.isMuted);
      view.setMuted(synth.isMuted);
    },
    onIntensity: (percent, committed) => {
      controller.setIntensity(percent / 100);
      if (committed) persist({ intensity: percent });
    },
    onCrackle: (percent, committed) => {
      synth.setCrackle(percent / CRACKLE_MIDPOINT);
      if (committed) persist({ crackle: percent });
    },
    onUnits: (units) => persist({ units }),
    onAutoStart: (autoStart) => persist({ autoStart }),
    onBackgroundPlay: (backgroundPlay) => {
      synth.setBackgroundPlay(backgroundPlay);
      persist({ backgroundPlay });
    },
    onRestartAudio: () => void synth.restart(),
  },
  APP_VERSION,
);

const controller = new EngineController({
  sound: synth,
  gps: new GpsSpeedSource(),
  profile: initialProfile,
  mode: 'gps',
  intensity: settings.intensity / 100,
  onTelemetry: (telemetry) => view.render(telemetry),
});

view.selectEngine(initialProfile);
view.showSettings(settings);
synth.setVolume(settings.volume / 100);
synth.setCrackle(settings.crackle / CRACKLE_MIDPOINT);
synth.setBackgroundPlay(settings.backgroundPlay);
view.render(controller.telemetry);

// With background play on, the car's media player (and wheel buttons) can start and stop it.
bindMediaSession({
  onPlay: () => {
    if (!controller.running) void togglePower();
  },
  onStop: () => {
    if (controller.running) void togglePower();
  },
});

// Browsers hold audio back until the page is touched (autoplay rules) and may pause it while the
// page is hidden. Any tap or key press, or coming back to the page, picks the sound up again.
const resumeAudio = (): void => {
  if (controller.running) void synth.resume();
};
document.addEventListener('pointerdown', resumeAudio, { capture: true });
document.addEventListener('keydown', resumeAudio, { capture: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resumeAudio();
});

if (!EngineSynth.isSupported()) {
  view.setBusy(true);
  view.showNotice('This browser cannot generate audio, so the engine cannot start.', 'error');
} else if (settings.autoStart) {
  void togglePower();
}

registerServiceWorker();

async function togglePower(): Promise<void> {
  if (powering) return;
  powering = true;
  view.setBusy(true);
  try {
    if (controller.running) {
      await controller.stop();
      showNowPlaying(null);
      await wakeLock.disable();
    } else {
      await controller.start();
      showNowPlaying(currentProfile.name);
      await wakeLock.enable();
    }
  } catch (error) {
    console.error(error);
    view.showNotice('The engine sound could not start. Tap Start engine to try again.', 'error');
  } finally {
    powering = false;
    view.setBusy(false);
  }
}

function persist(change: Partial<Settings>): void {
  settings = { ...settings, ...change };
  saveSettings(storage, settings);
}

function getLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
