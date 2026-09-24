const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Shanghai',
});

export function todayInShanghai(now = new Date()): string {
  return shanghaiDateFormatter.format(now);
}

export function millisecondsUntilShanghaiMidnight(now = new Date()): number {
  const midnight = new Date(`${todayInShanghai(now)}T00:00:00+08:00`).getTime();
  return midnight + 24 * 60 * 60 * 1000 - now.getTime();
}
