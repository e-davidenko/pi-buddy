/** Фейковые часы и случайность для тестов */
export function fakeClock(start = Date.UTC(2026, 9, 27, 12, 0, 0)) {
  let t = start;
  let seed = 42;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (v: number) => {
      t = v;
    },
    rng: () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    },
  };
}
