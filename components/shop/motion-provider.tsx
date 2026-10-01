"use client"

import { LazyMotion, MotionConfig } from "motion/react"
import type { ReactNode } from "react"

const loadFeatures = () => import("./motion-features").then((m) => m.default)

/**
 * Motion animations follow the visitor's "reduce motion" system setting. The
 * animation features load after the page, so components use `m.*`, not `motion.*`
 * (strict mode throws if a full `motion` component sneaks back in).
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  )
}
