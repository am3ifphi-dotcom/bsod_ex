/** Schedule both cameras from the same cutscene clock so the destination is already
 * moving before the throat scene disappears. The mask starts and ends fully opaque. */
export function tunnelHandoff(time: number, duration: number, overlap: number, arrivalAdvance: number): {
  progress: number;
  arrivalTime: number;
} {
  const t = Math.max(0, Math.min(1, (time - (duration - overlap)) / overlap));
  return { progress: t * t * (3 - 2 * t), arrivalTime: t * arrivalAdvance };
}
