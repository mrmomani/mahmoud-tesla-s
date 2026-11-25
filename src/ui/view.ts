import type { Pedal, SpeedMode, Telemetry } from '../app/controller';
import type { KeepAliveState } from '../engine/keepAlive';
import type { EngineProfile } from '../engine/profiles';
import type { AudioSnapshot } from '../engine/synth';
import { DEFAULT_SPEED_OPTIONS, type SpeedSourceKind } from '../speed/geo';
import type { GpsStatus } from '../speed/gpsSource';
import type { Settings, SpeedUnit } from '../storage/settings';
import { clamp } from '../util/math';

/** Fixes worse than this are ignored for speed, so tell the driver why the gauge reads 0. */
const WEAK_GPS_ACCURACY_M = DEFAULT_SPEED_OPTIONS.maxAccuracyM;
const PARKED_BELOW_KMH = 3;
const MPH_PER_KMH = 0.621371;
const DASH = '–';

export type Tone = 'info' | 'ok' | 'warn' | 'error';

interface Message {
  readonly text: string;
  readonly tone: Tone;
}

export interface ViewHandlers {
  readonly onPower: () => void;
  readonly onRev: (held: boolean) => void;
  readonly onPedal: (pedal: Pedal, held: boolean) => void;
  readonly onEngine: (id: string) => void;
  readonly onMode: (mode: SpeedMode) => void;
  readonly onVolume: (percent: number, committed: boolean) => void;
  readonly onMute: () => void;
  readonly onIntensity: (percent: number, committed: boolean) => void;
  readonly onCrackle: (percent: number, committed: boolean) => void;
  readonly onUnits: (units: SpeedUnit) => void;
  readonly onAutoStart: (enabled: boolean) => void;
  readonly onBackgroundPlay: (enabled: boolean) => void;
  readonly onRestartAudio: () => void;
}

export interface View {
  selectEngine(profile: EngineProfile): void;
  showSettings(settings: Settings): void;
  setMuted(muted: boolean): void;
  setBusy(busy: boolean): void;
  showNotice(text: string, tone: Tone): void;
  render(telemetry: Telemetry): void;
}

const DIAGNOSTIC_FIELDS = [
  'gps',
  'fixes',
  'rate',
  'age',
  'accuracy',
  'reported',
  'derived',
  'source',
  'clock',
  'error',
  'load',
  'audio',
  'latency',
  'background',
] as const;
export type Diagnostics = Record<(typeof DIAGNOSTIC_FIELDS)[number], string>;

const BACKGROUND_STATES: Record<KeepAliveState, string> = {
  off: 'Off',
  playing: 'On, listed as media',
  paused: 'Paused by the car or browser',
};

const MODE_NAMES: Record<SpeedMode, string> = {
  gps: 'GPS drive',
  demo: 'Demo drive',
  test: 'Test drive',
};

const GPS_STATES: Record<GpsStatus, string> = {
  off: 'Off',
  waiting: 'Waiting for a position',
  active: 'Active',
  timeout: 'Slow to respond, retrying',
  denied: 'Permission denied',
  unavailable: 'Position unavailable',
  unsupported: 'Not supported',
  insecure: 'Needs https://',
};

const SPEED_SOURCES: Record<SpeedSourceKind, string> = {
  none: DASH,
  device: 'Reported speed',
  derived: 'Speed from positions',
};

const UNIT_LABELS: Record<SpeedUnit, { readonly short: string; readonly long: string }> = {
  kmh: { short: 'km/h', long: 'Speed in kilometres per hour' },
  mph: { short: 'mph', long: 'Speed in miles per hour' },
};

/** Length of the tachometer arcs, fixed through the SVG `pathLength` attribute. */
const ARC_LENGTH = 1000;
const ARC_START_DEG = 135;
const ARC_SWEEP_DEG = 270;
const TICK_RADIUS = 62;
const SVG_NS = 'http://www.w3.org/2000/svg';

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export function formatSpeed(kmh: number, units: SpeedUnit): string {
  return String(Math.round(units === 'mph' ? kmh * MPH_PER_KMH : kmh));
}

export function describeStatus(telemetry: Telemetry): Message {
  if (!telemetry.running) {
    return { text: 'Pick an engine and press Start. Set things up while parked.', tone: 'info' };
  }
  if (telemetry.audio.state !== 'running') {
    return {
      text: 'The browser paused the sound. Tap anywhere on the page to resume.',
      tone: 'warn',
    };
  }
  if (telemetry.mode === 'demo') {
    return { text: 'Demo drive: a simulated trip loops through every gear.', tone: 'info' };
  }
  if (telemetry.mode === 'test') {
    return { text: 'Test drive: hold Gas or Brake (keyboard: ↑ or W, ↓ or S).', tone: 'info' };
  }
  const { status, accuracyM, stale } = telemetry.gps;
  switch (status) {
    case 'waiting':
      return { text: 'Waiting for GPS. Allow location access if the browser asks.', tone: 'warn' };
    case 'timeout':
      return { text: 'GPS is slow to respond. Still trying…', tone: 'warn' };
    case 'active':
      if (accuracyM !== null && accuracyM > WEAK_GPS_ACCURACY_M) {
        return {
          text: `Weak GPS fix (±${formatDistance(accuracyM)}). Speed may be unreliable until it improves.`,
          tone: 'warn',
        };
      }
      // Browsers may stop sending fixes while the car stands still, so quiet GPS is not a fault.
      if (stale && telemetry.speedKmh < PARKED_BELOW_KMH) {
        return { text: 'GPS ready. The engine will follow your speed once you drive.', tone: 'ok' };
      }
      if (stale) return { text: 'GPS signal lost. Holding the last speed briefly.', tone: 'warn' };
      return {
        text: `GPS active${accuracyM === null ? '' : ` (±${formatDistance(accuracyM)})`}. The engine follows your speed.`,
        tone: 'ok',
      };
    case 'denied':
      return {
        text: 'Location access is blocked. Allow it in the browser settings, or try Demo or Test drive.',
        tone: 'error',
      };
    case 'unavailable':
      return {
        text: 'No GPS position yet. Try a clear view of the sky, or use Demo drive.',
        tone: 'error',
      };
    case 'unsupported':
      return { text: 'This browser cannot share its location. Use Demo drive.', tone: 'error' };
    case 'insecure':
      return { text: 'GPS needs a secure page: open the site over https://.', tone: 'error' };
    case 'off':
      return { text: 'GPS is off.', tone: 'info' };
  }
}

/** Plain-language readings for checking GPS and audio in the car. */
export function describeDiagnostics(telemetry: Telemetry, units: SpeedUnit = 'kmh'): Diagnostics {
  const { gps, audio } = telemetry;
  const gpsLive = telemetry.mode === 'gps' && gps.status !== 'off';
  let gpsState = GPS_STATES[gps.status];
  if (telemetry.mode !== 'gps') gpsState = `Not used in ${MODE_NAMES[telemetry.mode]}`;
  else if (gps.status === 'active' && gps.stale) gpsState = 'No recent position';
  const received = gps.fixes.live + gps.fixes.fallback;
  const speed = (kmh: number): string => `${formatSpeed(kmh, units)} ${UNIT_LABELS[units].short}`;

  let reported = DASH;
  if (gpsLive && received > 0) {
    reported = gps.reportedKmh === null ? 'Not provided' : speed(gps.reportedKmh);
  }

  return {
    gps: gpsState,
    fixes: gpsLive ? `${received} (${gps.fixes.live} live, ${gps.fixes.fallback} fallback)` : DASH,
    rate: gpsLive && gps.updateHz !== null ? `${gps.updateHz.toFixed(1)} per second` : DASH,
    age: gpsLive && gps.fixAgeMs !== null ? `${(gps.fixAgeMs / 1000).toFixed(1)} s ago` : DASH,
    accuracy: gpsLive && gps.accuracyM !== null ? `±${formatDistance(gps.accuracyM)}` : DASH,
    reported,
    derived: gpsLive && gps.derivedKmh !== null ? speed(gps.derivedKmh) : DASH,
    source: gpsLive ? SPEED_SOURCES[gps.source] : DASH,
    clock: gpsLive && gps.clockOffsetMs !== null ? describeClock(gps.clockOffsetMs) : DASH,
    error: gpsLive ? (gps.lastError ?? 'None') : DASH,
    load: telemetry.running ? `${Math.round(telemetry.load * 100)}%` : DASH,
    audio: describeAudio(audio),
    latency: audio.latencyMs === null ? DASH : `${audio.latencyMs} ms in the browser`,
    background: BACKGROUND_STATES[audio.background],
  };
}

/** The app stamps fixes with its own clock, so a mismatch here is only reported, not used. */
function describeClock(offsetMs: number): string {
  const seconds = Math.abs(offsetMs) / 1000;
  if (seconds < 2) return 'In sync';
  let amount = `${Math.round(seconds / 86_400)} days`;
  if (seconds < 120) amount = `${seconds.toFixed(1)} s`;
  else if (seconds < 7200) amount = `${Math.round(seconds / 60)} min`;
  else if (seconds < 172_800) amount = `${(seconds / 3600).toFixed(1)} h`;
  return `Off by ${amount} (not used)`;
}

function describeAudio(audio: AudioSnapshot): string {
  switch (audio.state) {
    case 'off':
      return 'Off';
    case 'running':
      return audio.sampleRate === null ? 'Playing' : `Playing at ${audio.sampleRate / 1000} kHz`;
    case 'suspended':
      return 'Paused by the browser';
    case 'closed':
      return 'Closed';
    default:
      return String(audio.state);
  }
}

/** Keyboard pedals for the test drive; arrow keys stay with form controls that use them. */
export function pedalForKey(key: string, onFormControl: boolean): Pedal | null {
  switch (key) {
    case 'w':
    case 'W':
      return 'gas';
    case 's':
    case 'S':
      return 'brake';
    case 'ArrowUp':
      return onFormControl ? null : 'gas';
    case 'ArrowDown':
      return onFormControl ? null : 'brake';
    default:
      return null;
  }
}

export function createView(
  doc: Document,
  profiles: readonly EngineProfile[],
  handlers: ViewHandlers,
  appVersion: string,
): View {
  const speed = byId(doc, 'speed', HTMLOutputElement);
  const speedUnit = byId(doc, 'speed-unit', HTMLSpanElement);
  const rpm = byId(doc, 'rpm', HTMLOutputElement);
  const gear = byId(doc, 'gear', HTMLOutputElement);
  const fill = byId(doc, 'gauge-fill', SVGPathElement);
  const redline = byId(doc, 'gauge-redline', SVGPathElement);
  const ticks = byId(doc, 'gauge-ticks', SVGGElement);
  const power = byId(doc, 'power', HTMLButtonElement);
  const pedals = byId(doc, 'pedals', HTMLDivElement);
  const gas = byId(doc, 'gas', HTMLButtonElement);
  const brake = byId(doc, 'brake', HTMLButtonElement);
  const rev = byId(doc, 'rev', HTMLButtonElement);
  const volume = byId(doc, 'volume', HTMLInputElement);
  const mute = byId(doc, 'mute', HTMLButtonElement);
  const status = byId(doc, 'status', HTMLParagraphElement);
  const engineGrid = byId(doc, 'engine-grid', HTMLDivElement);
  const intensity = byId(doc, 'intensity', HTMLInputElement);
  const crackle = byId(doc, 'crackle', HTMLInputElement);
  const autoStart = byId(doc, 'auto-start', HTMLInputElement);
  const backgroundPlay = byId(doc, 'background-play', HTMLInputElement);
  const restartAudio = byId(doc, 'restart-audio', HTMLButtonElement);
  const diagnostics = byId(doc, 'diagnostics', HTMLDetailsElement);
  const diagnosticCells = DIAGNOSTIC_FIELDS.map(
    (field) => [field, byId(doc, `diag-${field}`, HTMLElement)] as const,
  );
  setText(byId(doc, 'diag-version', HTMLElement), appVersion);
  const modeInputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[name="mode"]'));
  const unitInputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[name="units"]'));

  let gaugeMaxRpm = 8000;
  let units: SpeedUnit = 'kmh';
  let shownMode: SpeedMode | null = null;
  let wasRunning = false;
  let notice: Message | null = null;
  let latest: Telemetry | null = null;

  engineGrid.replaceChildren(...profiles.map((profile) => engineCard(doc, profile)));

  const setRev = holdControl(rev, (held) => handlers.onRev(held));
  const pedalControls: Record<Pedal, (held: boolean) => void> = {
    gas: holdControl(gas, (held) => handlers.onPedal('gas', held)),
    brake: holdControl(brake, (held) => handlers.onPedal('brake', held)),
  };
  const releaseAll = (): void => {
    setRev(false);
    pedalControls.gas(false);
    pedalControls.brake(false);
  };

  const renderDiagnostics = (telemetry: Telemetry): void => {
    const values = describeDiagnostics(telemetry, units);
    for (const [field, cell] of diagnosticCells) setText(cell, values[field]);
  };

  const setUnits = (next: SpeedUnit): void => {
    units = next;
    for (const input of unitInputs) input.checked = input.value === next;
    setText(speedUnit, UNIT_LABELS[next].short);
    speed.setAttribute('aria-label', UNIT_LABELS[next].long);
    if (latest) {
      setText(speed, formatSpeed(latest.speedKmh, next));
      if (diagnostics.open) renderDiagnostics(latest);
    }
  };

  power.addEventListener('click', () => handlers.onPower());
  mute.addEventListener('click', () => handlers.onMute());
  bindSlider(volume, handlers.onVolume);
  bindSlider(intensity, handlers.onIntensity);
  bindSlider(crackle, handlers.onCrackle);
  autoStart.addEventListener('change', () => handlers.onAutoStart(autoStart.checked));
  backgroundPlay.addEventListener('change', () =>
    handlers.onBackgroundPlay(backgroundPlay.checked),
  );
  restartAudio.addEventListener('click', () => handlers.onRestartAudio());
  engineGrid.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.name === 'engine') {
      handlers.onEngine(target.value);
    }
  });
  for (const input of modeInputs) {
    input.addEventListener('change', () => {
      if (input.checked && isSpeedMode(input.value)) handlers.onMode(input.value);
    });
  }
  for (const input of unitInputs) {
    input.addEventListener('change', () => {
      if (!input.checked || !isSpeedUnit(input.value)) return;
      setUnits(input.value);
      handlers.onUnits(input.value);
    });
  }
  diagnostics.addEventListener('toggle', () => {
    if (diagnostics.open && latest) renderDiagnostics(latest);
  });

  doc.addEventListener('keydown', (event) => {
    if (pedals.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    const pedal = pedalForKey(event.key, isFormControl(event.target));
    if (!pedal || (pedal === 'gas' ? gas : brake).disabled) return;
    // Arrow keys would otherwise scroll the page while driving.
    event.preventDefault();
    if (!event.repeat) pedalControls[pedal](true);
  });
  doc.addEventListener('keyup', (event) => {
    const pedal = pedalForKey(event.key, false);
    if (pedal) pedalControls[pedal](false);
  });
  // A key or finger still down when the window loses focus never sends its release.
  doc.defaultView?.addEventListener('blur', releaseAll);

  return {
    selectEngine(profile) {
      for (const input of engineGrid.querySelectorAll<HTMLInputElement>('input[name="engine"]')) {
        input.checked = input.value === profile.id;
      }
      gaugeMaxRpm = Math.ceil((profile.redlineRpm * 1.08) / 1000) * 1000;
      const redlineShare = profile.redlineRpm / gaugeMaxRpm;
      redline.style.strokeDasharray = `0 ${redlineShare * ARC_LENGTH} ${(1 - redlineShare) * ARC_LENGTH}`;
      ticks.replaceChildren(...tickLabels(doc, gaugeMaxRpm));
    },
    showSettings(settings) {
      volume.value = String(settings.volume);
      intensity.value = String(settings.intensity);
      crackle.value = String(settings.crackle);
      autoStart.checked = settings.autoStart;
      backgroundPlay.checked = settings.backgroundPlay;
      setUnits(settings.units);
    },
    setMuted(muted) {
      mute.setAttribute('aria-pressed', String(muted));
      setText(mute, muted ? 'Unmute' : 'Mute');
    },
    setBusy(busy) {
      power.disabled = busy;
    },
    showNotice(text, tone) {
      notice = { text, tone };
      showMessage(status, notice);
    },
    render(telemetry) {
      latest = telemetry;
      if (telemetry.running !== wasRunning) {
        wasRunning = telemetry.running;
        notice = null;
      }
      // Browsers can restore an old radio choice on reload, so mirror the real mode.
      if (telemetry.mode !== shownMode) {
        shownMode = telemetry.mode;
        for (const input of modeInputs) input.checked = input.value === telemetry.mode;
      }

      setText(speed, formatSpeed(telemetry.speedKmh, units));
      setText(rpm, String(Math.round(telemetry.rpm / 10) * 10));
      setText(gear, telemetry.gear);
      const share = clamp(telemetry.rpm / gaugeMaxRpm, 0, 1);
      fill.style.strokeDashoffset = (ARC_LENGTH * (1 - share)).toFixed(1);
      // A zero-length arc still draws its round line cap, so hide it when there is nothing to show.
      fill.classList.toggle('is-empty', share < 0.005);
      fill.classList.toggle('is-hot', telemetry.rpm >= telemetry.redlineRpm * 0.9);
      power.setAttribute('aria-pressed', String(telemetry.running));
      setText(power, telemetry.running ? 'Stop engine' : 'Start engine');

      rev.disabled = !telemetry.canRev;
      if (rev.disabled) setRev(false);
      const testing = telemetry.mode === 'test';
      if (pedals.hidden === testing) pedals.hidden = !testing;
      const pedalsUsable = testing && telemetry.running;
      gas.disabled = !pedalsUsable;
      brake.disabled = !pedalsUsable;
      if (!pedalsUsable) {
        pedalControls.gas(false);
        pedalControls.brake(false);
      }

      showMessage(status, notice ?? describeStatus(telemetry));
      restartAudio.disabled = !telemetry.running;
      if (diagnostics.open) renderDiagnostics(telemetry);
    },
  };
}

/** Wires a press-and-hold button and mirrors its state for styling and assistive technology. */
function holdControl(
  button: HTMLButtonElement,
  onChange: (held: boolean) => void,
): (held: boolean) => void {
  let held = false;
  const set = (next: boolean): void => {
    if (next === held || (next && button.disabled)) return;
    held = next;
    button.classList.toggle('is-active', next);
    button.setAttribute('aria-pressed', String(next));
    onChange(next);
  };
  bindHoldButton(button, set);
  return set;
}

/** A press-and-hold button that works with touch, mouse, pen, and keyboard. */
function bindHoldButton(button: HTMLButtonElement, onChange: (held: boolean) => void): void {
  const release = (): void => onChange(false);
  button.addEventListener('pointerdown', (event) => {
    if (button.disabled) return;
    button.setPointerCapture(event.pointerId);
    onChange(true);
  });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
  button.addEventListener('blur', release);
  // A long press on touch screens would otherwise open the context menu.
  button.addEventListener('contextmenu', (event) => event.preventDefault());
  button.addEventListener('keydown', (event) => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault();
      onChange(true);
    }
  });
  button.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      release();
    }
  });
}

function bindSlider(
  input: HTMLInputElement,
  onChange: (value: number, committed: boolean) => void,
): void {
  input.addEventListener('input', () => onChange(input.valueAsNumber, false));
  input.addEventListener('change', () => onChange(input.valueAsNumber, true));
}

function engineCard(doc: Document, profile: EngineProfile): HTMLLabelElement {
  const input = doc.createElement('input');
  input.type = 'radio';
  input.name = 'engine';
  input.value = profile.id;

  const body = doc.createElement('span');
  body.className = 'engine-card__body';
  body.append(
    textSpan(doc, 'engine-card__name', profile.name),
    textSpan(doc, 'engine-card__layout', profile.layout),
    textSpan(doc, 'engine-card__character', profile.character),
  );

  const label = doc.createElement('label');
  label.className = 'engine-card';
  label.append(input, body);
  return label;
}

function tickLabels(doc: Document, maxRpm: number): SVGTextElement[] {
  const labels: SVGTextElement[] = [];
  for (let thousands = 0; thousands * 1000 <= maxRpm; thousands++) {
    const degrees = ARC_START_DEG + (ARC_SWEEP_DEG * thousands * 1000) / maxRpm;
    const radians = (degrees * Math.PI) / 180;
    const label = doc.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', (100 + TICK_RADIUS * Math.cos(radians)).toFixed(1));
    label.setAttribute('y', (100 + TICK_RADIUS * Math.sin(radians)).toFixed(1));
    label.textContent = String(thousands);
    labels.push(label);
  }
  return labels;
}

function textSpan(doc: Document, className: string, text: string): HTMLSpanElement {
  const span = doc.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function showMessage(element: HTMLElement, message: Message): void {
  setText(element, message.text);
  element.dataset.tone = message.tone;
}

function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function isFormControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

function isSpeedMode(value: string): value is SpeedMode {
  return value === 'gps' || value === 'demo' || value === 'test';
}

function isSpeedUnit(value: string): value is SpeedUnit {
  return value === 'kmh' || value === 'mph';
}

function byId<T extends Element>(doc: Document, id: string, type: { new (): T; prototype: T }): T {
  const element = doc.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Missing element #${id}`);
  return element;
}
