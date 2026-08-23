export const DEFAULT_TIMEZONE = 'America/New_York'

export type ZoneParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

export function partsInZone(date: Date, timeZone: string): ZoneParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const map: Record<string, string> = {}
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  }
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function ymdFromParts(p: Pick<ZoneParts, 'year' | 'month' | 'day'>): string {
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}

export function todayYmd(timeZone: string): string {
  return ymdFromParts(partsInZone(new Date(), timeZone))
}

/** Convert a civil datetime in `timeZone` to a UTC ISO-8601 string. */
export function zonedLocalToUtcIso(ymd: string, hm: string, timeZone: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const [hh, mm] = (hm || '00:00').split(':').map(Number)
  let utcMs = Date.UTC(y, m - 1, d, hh, mm, 0)
  for (let i = 0; i < 4; i++) {
    const parts = partsInZone(new Date(utcMs), timeZone)
    const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0)
    const wanted = Date.UTC(y, m - 1, d, hh, mm, 0)
    const delta = wanted - asIfUtc
    utcMs += delta
    if (delta === 0) break
  }
  return new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function utcIsoToLocal(iso: string, timeZone: string): { ymd: string; hm: string } {
  const p = partsInZone(new Date(iso), timeZone)
  return { ymd: ymdFromParts(p), hm: `${pad2(p.hour)}:${pad2(p.minute)}` }
}

/** Sunday-start 6-week grid for a calendar month (month is 1–12). */
export function monthGrid(year: number, month: number): string[] {
  const first = `${year}-${pad2(month)}-01`
  const [fy, fm, fd] = first.split('-').map(Number)
  const weekday = new Date(Date.UTC(fy, fm - 1, fd)).getUTCDay()
  const start = addDaysYmd(first, -weekday)
  const days: string[] = []
  for (let i = 0; i < 42; i++) {
    days.push(addDaysYmd(start, i))
  }
  return days
}

export function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}
