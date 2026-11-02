/** Пакеты pi переименовывались (@mariozechner -> @earendil-works), пробуем оба */
export async function importPi(sub: string): Promise<any> {
  for (const scope of ["@earendil-works", "@mariozechner"]) {
    try {
      return await import(`${scope}/${sub}`);
    } catch {
      /* следующий */
    }
  }
  return null;
}
