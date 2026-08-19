/** Shared Motion timing. Product UI stays in the 150–250ms band. */
export const EASE_OUT_QUINT = [0.22, 1, 0.36, 1] as const;

export const MOTION_DURATION = {
  instant: 0.12,
  feedback: 0.15,
  state: 0.2,
  layout: 0.25,
} as const;

export const MOTION_TRANSITION = {
  duration: MOTION_DURATION.state,
  ease: EASE_OUT_QUINT,
} as const;
