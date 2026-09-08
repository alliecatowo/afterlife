// Transcribed verbatim (name, category, dimensions, population, explanation,
// verified fact) from `src/content/specimens.ts` / `docs/verification/scenes.json`
// — the 24-entry corpus the app actually ships. Do not invent entries; if the
// app's corpus changes, update this alongside it.
export const SPECIMENS = [
  { name: 'block', category: 'still', w: 2, h: 2, pop: 4, explanation: 'Four cells in a square; the smallest and most common still life.', fact: 'Still life — unchanged forever.' },
  { name: 'beehive', category: 'still', w: 4, h: 3, pop: 6, explanation: 'A six-cell hexagonal still life, the second most common ash object.', fact: 'Still life — unchanged forever.' },
  { name: 'loaf', category: 'still', w: 4, h: 4, pop: 7, explanation: 'A seven-cell still life shaped like a beehive with a tail.', fact: 'Still life — unchanged forever.' },
  { name: 'boat', category: 'still', w: 3, h: 3, pop: 5, explanation: 'A five-cell still life; the only five-cell still life besides its reflections.', fact: 'Still life — unchanged forever.' },
  { name: 'tub', category: 'still', w: 3, h: 3, pop: 4, explanation: 'Four cells in a diamond, the smallest still life with a hole.', fact: 'Still life — unchanged forever.' },
  { name: 'ship', category: 'still', w: 3, h: 3, pop: 6, explanation: 'A six-cell still life; two boats fused along a diagonal.', fact: 'Still life — unchanged forever.' },
  { name: 'pond', category: 'still', w: 4, h: 4, pop: 8, explanation: 'An eight-cell still life with a 2x2 hole.', fact: 'Still life — unchanged forever.' },
  { name: 'blinker', category: 'oscillator', w: 3, h: 1, pop: 3, explanation: 'Three cells that flip between horizontal and vertical every generation.', fact: 'Oscillator — period 2.' },
  { name: 'toad', category: 'oscillator', w: 4, h: 2, pop: 6, explanation: 'Two offset rows of three that breathe in and out.', fact: 'Oscillator — period 2.' },
  { name: 'beacon', category: 'oscillator', w: 4, h: 4, pop: 8, explanation: 'Two diagonally touching blocks whose inner corners blink off and on.', fact: 'Oscillator — period 2.' },
  { name: 'clock', category: 'oscillator', w: 4, h: 4, pop: 6, explanation: 'A six-cell period-2 oscillator whose arms rotate a quarter turn.', fact: 'Oscillator — period 2.' },
  { name: 'pulsar', category: 'oscillator', w: 13, h: 13, pop: 48, explanation: 'A large, highly symmetric period-3 oscillator; the most common of its period.', fact: 'Oscillator — period 3.' },
  { name: 'pentadecathlon', category: 'oscillator', w: 10, h: 3, pop: 12, explanation: 'A period-15 oscillator that stretches and pinches along its long axis.', fact: 'Oscillator — period 15.' },
  { name: 'glider', category: 'spaceship', w: 3, h: 3, pop: 5, explanation: 'The smallest spaceship: five cells that walk one square diagonally every four generations.', fact: 'Spaceship — period 4, moves (1, 1) per period.' },
  { name: 'lwss', category: 'spaceship', w: 5, h: 4, pop: 9, explanation: 'Lightweight spaceship: nine cells travelling two squares orthogonally every four generations.', fact: 'Spaceship — period 4, moves (−2, 0) per period.' },
  { name: 'mwss', category: 'spaceship', w: 6, h: 5, pop: 11, explanation: 'Middleweight spaceship: an LWSS with one extra bump, same speed.', fact: 'Spaceship — period 4, moves (−2, 0) per period.' },
  { name: 'hwss', category: 'spaceship', w: 7, h: 5, pop: 13, explanation: 'Heavyweight spaceship: the largest of the three classic orthogonal ships.', fact: 'Spaceship — period 4, moves (−2, 0) per period.' },
  { name: 'gosper-glider-gun', category: 'emitter', w: 36, h: 9, pop: 36, explanation: 'Two shuttles whose collision debris condenses into a new glider every 30 generations.', fact: 'Emitter — one glider (+5 cells) every 30 generations, checked over generations 600–1200.' },
  { name: 'simkin-glider-gun', category: 'emitter', w: 33, h: 21, pop: 36, explanation: 'A gun built from four blocks and two shuttles that fires one glider every 120 generations.', fact: 'Emitter — one glider (+5 cells) every 120 generations, checked over generations 600–1200.' },
  { name: 'r-pentomino', category: 'seed', w: 3, h: 3, pop: 5, explanation: 'Five cells that churn for over a thousand generations before settling.', fact: 'Seed (unbounded grid) — stabilises at generation 1103, population 116; peak population 319 at generation 821.' },
  { name: 'acorn', category: 'seed', w: 7, h: 3, pop: 7, explanation: 'Seven cells that take more than five thousand generations to settle.', fact: 'Seed (unbounded grid) — stabilises at generation 5206, population 633; peak population 1057 at generation 4408.' },
  { name: 'diehard', category: 'seed', w: 8, h: 3, pop: 7, explanation: 'Seven cells that thrash for 130 generations and then vanish completely.', fact: 'Seed (unbounded grid) — dies out completely at generation 130; peak population 40.' },
  { name: 'b-heptomino', category: 'seed', w: 4, h: 3, pop: 7, explanation: 'A seven-cell methuselah that settles quickly compared to its cousins.', fact: 'Seed (unbounded grid) — stabilises at generation 148, population 28; peak population 123 at generation 121.' },
  { name: 'pi-heptomino', category: 'seed', w: 3, h: 3, pop: 7, explanation: 'A seven-cell methuselah with a longer, showier burn than the b-heptomino.', fact: 'Seed (unbounded grid) — stabilises at generation 173, population 55; peak population 201 at generation 115.' },
];

export const CATEGORY_LABELS = {
  still: 'Still lifes',
  oscillator: 'Oscillators',
  spaceship: 'Spaceships',
  emitter: 'Emitters (guns)',
  seed: 'Seeds (methuselahs)',
};

export const CATEGORY_ORDER = ['still', 'oscillator', 'spaceship', 'emitter', 'seed'];
