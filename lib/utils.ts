import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS class names, resolving conflicting utilities.
 * Used by all shadcn/ui primitives.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
