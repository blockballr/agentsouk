// shared spring and easing presets for the site's motion vocabulary
export const SPRING_STIFF = { type: 'spring', stiffness: 350, damping: 28 } as const
export const SPRING_SMOOTH = { type: 'spring', stiffness: 300, damping: 30 } as const
export const SPRING_BOUNCY = { type: 'spring', stiffness: 280, damping: 26 } as const

// duration-based ease for fades and cross-fades
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const