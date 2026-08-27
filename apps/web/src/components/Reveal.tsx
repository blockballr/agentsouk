import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { SPRING_SMOOTH } from '../lib/motion'

// gentle fade-up when a section scrolls into view, once
// reduced motion is respected globally via MotionConfig
export function Reveal({
  children,
  className,
  delay = 0,
  y = 16,
}: {
  children: ReactNode
  className?: string
  delay?: number
  y?: number
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -80px 0px' }}
      transition={{ ...SPRING_SMOOTH, delay }}
    >
      {children}
    </motion.div>
  )
}