export interface Transmission {
  /** Ratio of each forward gear, first gear first. */
  readonly gearRatios: readonly number[];
  readonly finalDrive: number;
  readonly wheelRadiusM: number;
}

/** Tone settings for the synthesizer. Levels are 0..1 unless noted. */
export interface SoundCharacter {
  /** Relative amplitude of each harmonic of the firing frequency. */
  readonly harmonics: readonly number[];
  /** Rumble at half the firing frequency that gives uneven-firing engines their burble. */
  readonly halfOrder: number;
  /** Amplitude modulation at crankshaft speed that makes the idle lumpy. */
  readonly lumpiness: number;
  /** Intake and exhaust noise. */
  readonly noise: number;
  /** Soft-clipping distortion. */
  readonly drive: number;
  /** Multiplier for the tone filter cutoff; higher is brighter. */
  readonly brightness: number;
  /** Turbo whistle level. */
  readonly turbo: number;
  /** Pops and crackles after lifting off the throttle. */
  readonly crackle: number;
}

export interface EngineProfile {
  readonly id: string;
  readonly name: string;
  readonly layout: string;
  readonly character: string;
  /** Power strokes per crankshaft revolution: cylinders / 2 for four-strokes, rotors for rotaries. */
  readonly firingsPerRevolution: number;
  readonly idleRpm: number;
  readonly redlineRpm: number;
  readonly transmission: Transmission;
  readonly sound: SoundCharacter;
}

const V8_MUSCLE: EngineProfile = {
  id: 'v8-muscle',
  name: 'V8 Muscle',
  layout: '6.2L V8 · cross-plane',
  character: 'Deep, lumpy burble',
  firingsPerRevolution: 4,
  idleRpm: 750,
  redlineRpm: 6500,
  transmission: {
    gearRatios: [2.97, 2.07, 1.43, 1.0, 0.84, 0.56],
    finalDrive: 3.73,
    wheelRadiusM: 0.34,
  },
  sound: {
    harmonics: [1, 0.55, 0.35, 0.22, 0.14, 0.08],
    halfOrder: 0.6,
    lumpiness: 0.5,
    noise: 0.25,
    drive: 0.6,
    brightness: 0.9,
    turbo: 0,
    crackle: 0.6,
  },
};

export const PROFILES: readonly EngineProfile[] = [
  V8_MUSCLE,
  {
    id: 'v10-supercar',
    name: 'V10 Supercar',
    layout: '5.2L V10 · high-revving',
    character: 'Sharp, rising scream',
    firingsPerRevolution: 5,
    idleRpm: 1000,
    redlineRpm: 8700,
    transmission: {
      gearRatios: [3.13, 2.59, 1.96, 1.57, 1.24, 1.0, 0.8],
      finalDrive: 3.25,
      wheelRadiusM: 0.33,
    },
    sound: {
      harmonics: [1, 0.75, 0.55, 0.4, 0.3, 0.22, 0.15, 0.1],
      halfOrder: 0.12,
      lumpiness: 0.1,
      noise: 0.18,
      drive: 0.4,
      brightness: 1.6,
      turbo: 0,
      crackle: 0.3,
    },
  },
  {
    id: 'v12-gt',
    name: 'V12 Grand Tourer',
    layout: '6.5L V12 · naturally aspirated',
    character: 'Smooth, soaring wail',
    firingsPerRevolution: 6,
    idleRpm: 900,
    redlineRpm: 8500,
    transmission: {
      gearRatios: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.66],
      finalDrive: 3.44,
      wheelRadiusM: 0.34,
    },
    sound: {
      harmonics: [1, 0.6, 0.48, 0.34, 0.26, 0.2, 0.15, 0.1, 0.07],
      halfOrder: 0.05,
      lumpiness: 0.05,
      noise: 0.12,
      drive: 0.25,
      brightness: 1.45,
      turbo: 0,
      crackle: 0.15,
    },
  },
  {
    id: 'i6-turbo',
    name: 'Inline-6 Turbo',
    layout: '3.0L I6 · twin-turbo',
    character: 'Silky, with turbo whistle',
    firingsPerRevolution: 3,
    idleRpm: 800,
    redlineRpm: 7000,
    transmission: {
      gearRatios: [5.0, 3.2, 2.14, 1.72, 1.31, 1.0, 0.82, 0.64],
      finalDrive: 2.81,
      wheelRadiusM: 0.34,
    },
    sound: {
      harmonics: [1, 0.45, 0.42, 0.22, 0.16, 0.1],
      halfOrder: 0.1,
      lumpiness: 0.12,
      noise: 0.3,
      drive: 0.4,
      brightness: 1.1,
      turbo: 0.7,
      crackle: 0.35,
    },
  },
  {
    id: 'flat6-sports',
    name: 'Flat-6 Sports',
    layout: '4.0L flat-6 · naturally aspirated',
    character: 'Raspy, metallic howl',
    firingsPerRevolution: 3,
    idleRpm: 900,
    redlineRpm: 9000,
    transmission: {
      gearRatios: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84],
      finalDrive: 3.97,
      wheelRadiusM: 0.34,
    },
    sound: {
      harmonics: [1, 0.7, 0.6, 0.45, 0.32, 0.22, 0.14],
      halfOrder: 0.25,
      lumpiness: 0.15,
      noise: 0.24,
      drive: 0.5,
      brightness: 1.5,
      turbo: 0,
      crackle: 0.3,
    },
  },
  {
    id: 'i4-hatch',
    name: 'Inline-4 Hot Hatch',
    layout: '2.0L I4 · turbo',
    character: 'Buzzy and eager',
    firingsPerRevolution: 2,
    idleRpm: 850,
    redlineRpm: 6800,
    transmission: {
      gearRatios: [3.36, 2.09, 1.47, 1.1, 0.87, 0.71],
      finalDrive: 3.65,
      wheelRadiusM: 0.32,
    },
    sound: {
      harmonics: [1, 0.6, 0.32, 0.26, 0.12, 0.08],
      halfOrder: 0.15,
      lumpiness: 0.2,
      noise: 0.32,
      drive: 0.5,
      brightness: 1.2,
      turbo: 0.4,
      crackle: 0.5,
    },
  },
  {
    id: 'rotary',
    name: 'Twin-Rotor',
    layout: '1.3L rotary',
    character: 'Brappy, high-revving buzz',
    firingsPerRevolution: 2,
    idleRpm: 1000,
    redlineRpm: 9000,
    transmission: {
      gearRatios: [3.48, 2.02, 1.39, 1.0, 0.72],
      finalDrive: 4.1,
      wheelRadiusM: 0.32,
    },
    sound: {
      harmonics: [1, 0.85, 0.65, 0.5, 0.38, 0.28, 0.2],
      halfOrder: 0.3,
      lumpiness: 0.35,
      noise: 0.35,
      drive: 0.65,
      brightness: 1.3,
      turbo: 0,
      crackle: 0.7,
    },
  },
];

export const DEFAULT_PROFILE: EngineProfile = V8_MUSCLE;

export function findProfile(id: string): EngineProfile {
  return PROFILES.find((profile) => profile.id === id) ?? DEFAULT_PROFILE;
}
