/** 0 -> "00:00:00", 3725 -> "1:02:05". Hours unpadded, as the Angular popup showed them. */
export function secondsToString(sec) {
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec - hours * 3600) / 60);
  const seconds = sec - hours * 3600 - minutes * 60;
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${hours > 0 ? `${hours}:` : '00:'}${pad(minutes)}:${pad(seconds)}`;
}
