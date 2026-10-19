// All the numbers you might want to tune live here, in one place.
// Values marked PLACEHOLDER are sensible guesses until we can check them
// against real data from the car (Phase 2 calibration drive).

export const APP_NAME = 'SHIFTGRID';

export const CAR = {
  idleRpm: 750,
  redlineRpm: 6500, // PLACEHOLDER: confirm on the tachometer
  // 8-speed ratios used by this family of ZF gearbox. PLACEHOLDER until calibrated.
  gearRatios: [4.714, 3.143, 2.106, 1.667, 1.285, 1.0, 0.839, 0.667],
  finalDrive: 3.31, // PLACEHOLDER
  tyreCircumferenceM: 2.2, // 275/35 R20 rear, approx.
};

// Engine rpm per km/h in each gear, derived from the numbers above.
export const RPM_PER_KMH = CAR.gearRatios.map(
  (r) => (1000 / 3600 / CAR.tyreCircumferenceM) * 60 * r * CAR.finalDrive
);

export const GEAR_DETECT = {
  minSpeedKmh: 8, // below this the torque converter slips, so gear can't be calculated
  tolerance: 0.1, // how close rpm/speed must be to a gear's ratio (10%)
  stableSamples: 2, // readings in a row before we believe a gear change
};

export const GRADING = {
  upshift: {
    idealLightThrottle: 2400, // ideal shift rpm when cruising gently
    idealFullThrottle: 6200, // ideal shift rpm at full throttle
    perfectWindow: 250, // +/- rpm for PERFECT
    goodWindow: 600, // +/- rpm for GOOD
    minThrottle: 12, // shifts below this throttle % (coasting) aren't graded
    lugRpm: 1300, // landing below this rpm under load = LUGGED
    lugThrottle: 35,
  },
  downshift: {
    windowMs: 600, // how long after a downshift we watch the g-force
    smoothSpike: 0.08, // g; below = SMOOTH
    okSpike: 0.18, // g; below = OK, above = ROUGH
  },
  points: { PERFECT: 100, GOOD: 50, SMOOTH: 60, OK: 20 },
  comboPerMultiplier: 3, // every 3 clean shifts adds x1
  maxMultiplier: 5,
};

export const DRIVING = {
  harshBrakeG: 0.4, // deceleration harder than this counts as harsh braking
  harshBrakeMs: 300,
  gentleBrakeG: 0.3, // Gentle Giant badge limit
  coldCoolantC: 70, // Game Mode unlocks at this coolant temperature
  coldRevLimit: 4000, // revving past this while cold breaks Cold Start Discipline
  coldRevXpPenalty: 25,
};

export const LAUNCH = {
  armAfterStoppedMs: 1000,
  targetKmh: 96.56, // 60 mph
  quarterMileM: 402.34,
  maxRunS: 25,
  showIfUnderS: 12, // ignore gentle pull-aways
};

// Ghost runs. Phase 1 uses distance laps; Phase 2 will use a GPS start/finish line.
export const TRACK = {
  lapLengthM: 3000,
  traceStepM: 50,
};

export const SHIFT_ASSIST = {
  leadS: 0.35, // cue this far ahead of the ideal point (data delay + your reaction time)
  coldMaxRpm: 3500, // while the engine is cold, cue no higher than this
  minThrottle: 12, // no cue when coasting
  maxLeadRpm: 900, // never cue more than this many rpm early
  rearmBelow: 600, // if revs drop this far after a cue without a shift, cue again next time
  flashMs: 800,
};

export const BANNER_MS = 1500;
