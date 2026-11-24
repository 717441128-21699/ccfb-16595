import { SPOTS } from './spots';
import { computeSpotHydro, type SpotHydro } from './hydrodynamics';

export const HYDRO: Record<string, SpotHydro> = Object.fromEntries(
  SPOTS.map((spot) => [spot.id, computeSpotHydro(spot)]),
);

export function getHydro(id: string): SpotHydro {
  return HYDRO[id] ?? HYDRO[SPOTS[1].id];
}
