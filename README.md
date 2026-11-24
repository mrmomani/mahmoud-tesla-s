# Mahmoud Tesla S

A small web app that plays a synthesized engine sound that follows your car's speed. Open it in
the car browser, pick an engine, press **Start engine**, and drive: the app reads GPS speed,
works out gear, revs, and throttle, and shapes the sound in real time.

Unofficial personal project, not affiliated with Tesla, Inc.

## Features

- **GPS-driven engine sound.** Speed comes from the browser's Geolocation API. The device-reported
  speed is used when available; otherwise speed is derived from distance over time, with
  filtering for inaccurate fixes, parked-car jitter, and impossible spikes. Between position
  updates the app projects the recent speed trend forward (up to 1.5 s) so the revs lag the car
  less.
- **Seven synthesized engines.** V8 muscle, V10 supercar, V12 grand tourer, inline-6 turbo,
  flat-6, inline-4 hot hatch, and twin-rotor. There are no audio files; everything is generated
  with the Web Audio API, so the app is tiny and works offline.
- **Automatic gearbox model.** Gears, shift points that rise with throttle, kickdown, clutch slip at
  launch, a brief torque cut on upshifts, and a rev limiter.
- **Three speed sources.** **GPS drive** follows the car. **Demo drive** loops a simulated trip.
  **Test drive** adds on-screen **Gas** and **Brake** pedals (or <kbd>↑</kbd>/<kbd>W</kbd> and
  <kbd>↓</kbd>/<kbd>S</kbd> on a keyboard) to try an engine while parked.
- **Hold to rev.** Rev in neutral while stopped; disabled above 5 km/h.
- **Gauges.** Speed in km/h or mph, gear, and a tachometer with a redline zone.
- **More settings.** **Intensity** (how eagerly acceleration turns into throttle, which also holds
  gears longer), **Pops and crackles** on lift-off, speed units, starting the engine when the page
  opens, and experimental background play.
- **Diagnostics.** GPS status, speed source, accuracy, update rate, age of the last position,
  throttle estimate, audio state and delay, plus a **No sound? Restart audio** button.
- **Autoplay-safe.** If the browser holds the sound back until the screen is touched, or pauses it
  while the page is hidden, the status line says so and any tap brings it back.
- **Offline and remembered.** A service worker keeps the app available after the first visit. The
  engine, volume, and **More settings** choices are stored locally. The app always opens in
  **GPS drive**, so a demo or test drive never carries over into the next real drive.
- **Private.** No accounts, no analytics, no network calls; your location never leaves the device.

## Use it in the car

1. Deploy the built site to any static host that serves HTTPS (see [Deploy](#deploy)). Browsers
   only share location with secure pages.
2. While parked, open the URL in the car browser and bookmark it.
3. Pick an engine and press **Start engine**. Allow location access when the browser asks.
4. Turn up the car's media volume, set the app's volume, then drive. Keep the browser open on
   screen.

Safety: set everything up while parked, keep the volume low enough to hear the road and emergency
vehicles, and follow local laws.

### Known limitations in the car

| What you may notice                                                | Why                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sound stops when you open the map or camera, or shift into Reverse | Most web pages go quiet when the browser is not on screen ([EV Sound FX](https://evsoundfx.com/blog/tesla-browser-audio-not-working/), [TeslaSound](https://teslasound.io/)). Try **Keep playing when I leave the browser**; it is untested in a Tesla.                               |
| Revs trail the car slightly                                        | GPS only sees a speed change after it happens, and the car's audio system adds about a quarter of a second ([TeslaSound FAQ](https://teslasound.io/)).                                                                                                                                |
| Revs stay at idle in a garage or tunnel                            | There is no GPS fix indoors. **Diagnostics** shows the GPS state and accuracy.                                                                                                                                                                                                        |
| Music pauses, or the engine stops when music starts                | The car plays one media source at a time ([EV Sound FX](https://evsoundfx.com/blog/tesla-browser-audio-not-working/)), while [TeslaSound](https://teslasound.io/) says its web audio plays along with Spotify or the radio. Check it on your car, especially with background play on. |
| No sound at all after opening the page                             | Browsers block sound until the page is touched. Tap anywhere on the page.                                                                                                                                                                                                             |
| No sound from the Boombox                                          | A web page plays inside the car only; it cannot use the external speaker ([TeslaSound](https://teslasound.io/)).                                                                                                                                                                      |
| Silent while driving on older software                             | In 2019, web audio was reported to play only in Park ([Tesla Motors Club](https://teslamotorsclub.com/tmc/threads/webaudio-only-while-in-park-and-only-when-browser-is-visible.168346/)). Current apps work while driving; check on your car.                                         |

### Troubleshooting

1. Check the car's media volume and that the media player is not muted.
2. Pause other media sources (radio, Spotify, Bluetooth phone), then tap the page.
3. Open **Diagnostics**: if **Audio** is not **Playing**, tap **No sound? Restart audio**.
4. If GPS shows **Permission denied**, allow location for the site in the browser settings.
5. Still silent: restart the touchscreen while parked, then reopen the page.

### Keyboard shortcuts

| Keys                                                  | Action                                      |
| ----------------------------------------------------- | ------------------------------------------- |
| <kbd>↑</kbd> or <kbd>W</kbd>                          | Gas (in **Test drive**)                     |
| <kbd>↓</kbd> or <kbd>S</kbd>                          | Brake (in **Test drive**)                   |
| <kbd>Space</kbd> or <kbd>Enter</kbd> on a hold button | Hold **Gas**, **Brake**, or **Hold to rev** |

## Develop

Requires Node.js 22.12 or later.

| Command              | What it does                                          |
| -------------------- | ----------------------------------------------------- |
| `npm install`        | Install dependencies                                  |
| `npm run dev`        | Start the dev server at <http://localhost:5173>       |
| `npm run check`      | Type-check, lint, and run the unit tests              |
| `npm run build`      | Type-check and build the static site into `dist/`     |
| `npm run preview`    | Serve the production build at <http://localhost:4173> |
| `npm run format`     | Format the code and apply safe lint fixes             |
| `npm run test:watch` | Re-run tests on every change                          |

On a laptop, use **Demo drive** or **Test drive** to hear the engine without moving. `localhost`
counts as a secure page, so location prompts work there too.

## Deploy

The site is published with GitHub Pages. Every push to `main` runs
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which type-checks, lints, tests, and
builds the app, then publishes `dist/`. A failing check stops the deployment, so a broken build
never replaces the live site.

To publish your own copy:

1. Create a GitHub repository. With GitHub Free it must be public; the site itself is public
   either way.
2. In the repository, open **Settings** > **Pages** and set **Source** to **GitHub Actions**.
3. Push this project to the repository's `main` branch. The site appears at
   `https://<owner>.github.io/<repository>/` once the **Deploy to GitHub Pages** workflow finishes.

`npm run build` produces a static `dist/` folder that uses relative paths, so it works at a domain
root or in a sub-folder. Any other static host with HTTPS works too, such as Netlify or Cloudflare
Pages: either upload the contents of `dist/`, or configure the host to run `npm run build` and
publish `dist`.

The page has a `noindex` tag, so search engines leave it out of their results. Remove that tag from
`index.html` if you want the site listed.

When you change a file in `public/` (icon, manifest, or service worker), bump `CACHE_NAME` in
`public/sw.js` so devices that already opened the app pick up the new copy. Files under
`dist/assets/` have content hashes in their names and never need this.

The name includes the Tesla trademark. That is fine for a personal, unlisted page; for a public
release, pick a name without it.

## How it works

```text
GPS fix ──► SpeedEstimator ──► EngineController ──► drivetrain ──► EngineSynth ──► speakers
(or demo,   (filter, derive,    (smooth speed,       (gear, rpm)     (Web Audio)
 test drive) project trend)      estimate throttle)          └──────► gauges
```

| Path                       | Responsibility                                                          |
| -------------------------- | ----------------------------------------------------------------------- |
| `src/engine/profiles.ts`   | Engine definitions: rev range, gearbox, and sound character             |
| `src/engine/drivetrain.ts` | Pure gear, rpm, shift, launch, and throttle-estimation logic            |
| `src/engine/synth.ts`      | Web Audio synthesizer, autoplay recovery, and audio restart             |
| `src/engine/keepAlive.ts`  | Silent media loop for experimental background play                      |
| `src/speed/geo.ts`         | Pure GPS speed estimation (filtering, trend projection, staleness)      |
| `src/speed/gpsSource.ts`   | Geolocation adapter with permission and error handling                  |
| `src/speed/demo.ts`        | Simulated drive profile                                                 |
| `src/speed/testDrive.ts`   | Pedal-driven speed physics for **Test drive**                           |
| `src/app/controller.ts`    | Simulation loop that ties speed, drivetrain, sound, and gauges together |
| `src/app/mediaSession.ts`  | Now-playing info and play/pause buttons in the car's media player       |
| `src/ui/view.ts`           | DOM rendering, input handling, and diagnostics (no `innerHTML`)         |
| `src/storage/settings.ts`  | Validated settings persistence in `localStorage`                        |
| `public/sw.js`             | Offline cache                                                           |

The loop runs on a 40 ms timer rather than `requestAnimationFrame`: browsers keep timers running for
pages that are playing audio, so the engine keeps following your speed even if the page is hidden.

Background play loops an eight-second silent WAV file, generated in the page, through an `<audio>`
element. Browsers list longer media in the system media player, which some cars keep playing
behind other screens; the engine itself stays on low-latency Web Audio. The content security
policy allows `blob:` media for this file only.

### Sound model

The firing frequency is `rpm / 60 × firings per revolution` (cylinders / 2 for a four-stroke engine,
rotors for a rotary). Each engine mixes:

- a harmonic oscillator at the firing frequency, shaped by the profile's harmonic amplitudes;
- a half-order rumble for the burble of uneven-firing engines;
- crank-speed amplitude modulation for a lumpy idle;
- band-passed noise for intake and exhaust roar, louder under throttle;
- an optional turbo whistle that spools with throttle and revs;
- random pops and crackles after lifting off the throttle.

The mix goes through a lowpass filter that opens with revs and throttle, soft-clipping distortion,
a low-frequency boost for body, and a limiter that prevents clipping.

## Add an engine

Add an `EngineProfile` to `PROFILES` in `src/engine/profiles.ts`:

- `firingsPerRevolution`, `idleRpm`, `redlineRpm`: the basic rhythm and rev range.
- `transmission`: gear ratios (first gear first), final drive, and wheel radius in metres.
- `sound`: harmonic amplitudes plus `halfOrder`, `lumpiness`, `noise`, `drive`, `brightness`,
  `turbo`, and `crackle`, each from 0 to 1 (`brightness` is a multiplier around 1).

The drivetrain tests run every profile through a full-throttle pull, so `npm run check` catches
gearboxes that hunt between gears.

## References

- [Geolocation API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)
- [GeolocationCoordinates.speed (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/speed)
- [Web Audio API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Autoplay guide for media and Web Audio APIs (MDN)](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [Media Session API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API)
- [Tesla Model S owner's manual: Media](https://www.tesla.com/ownersmanual/models/en_be/GUID-7A85FB6B-9DF6-4C55-A2F9-793207E48E9D.html)
- [TeslaSound](https://teslasound.io/) and [EV Sound FX](https://evsoundfx.com/blog/tesla-browser-audio-not-working/), similar engine-sound sites
