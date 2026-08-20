'use client';

import { DayPicker, type DayPickerProps } from 'react-day-picker';

import { cn } from '@/lib/utils';

import 'react-day-picker/style.css';

export type CalendarProps = DayPickerProps;

/** Themed DayPicker used by the meeting-time picker. */
export function Calendar({ className, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={1}
      navLayout="around"
      className={cn(
        'rdp-root [--rdp-accent-color:hsl(var(--primary))] [--rdp-accent-background-color:hsl(var(--accent))] [--rdp-today-color:hsl(var(--gold))] [--rdp-day-height:2.25rem] [--rdp-day-width:2.25rem] [--rdp-day_button-height:2.125rem] [--rdp-day_button-width:2.125rem] [--rdp-day_button-border-radius:0.375rem] [--rdp-selected-border:2px solid transparent] [--rdp-nav-height:2.25rem]',
        'text-body [&_.rdp-month_caption]:text-body [&_.rdp-month_caption]:font-semibold',
        '[&_.rdp-selected_.rdp-day_button]:bg-primary [&_.rdp-selected_.rdp-day_button]:text-primary-foreground',
        '[&_.rdp-day_button]:text-body [&_.rdp-weekday]:text-meta',
        className,
      )}
      {...props}
    />
  );
}
