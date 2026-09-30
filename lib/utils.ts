import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Picks the Ukrainian plural form for a count:
 * pluralUk(1, ["товар", "товари", "товарів"]) → "товар", 3 → "товари", 5 → "товарів".
 */
export function pluralUk(count: number, [one, few, many]: [string, string, string]): string {
  const n = Math.abs(count) % 100
  const n10 = n % 10
  if (n > 10 && n < 20) return many
  if (n10 === 1) return one
  if (n10 >= 2 && n10 <= 4) return few
  return many
}
