"use client"

import { MotionConfig } from "motion/react"
import type { ReactNode } from "react"

/** Motion animations follow the visitor's "reduce motion" system setting. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
