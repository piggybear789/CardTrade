'use client';

// components/ui/date-time-picker.tsx
//
// Replaces the OS `datetime-local` popup (Chrome's calendar + scroll wheels)
// with a calendar and a short list of meetup times. The value stays the same
// `YYYY-MM-DDTHH:mm` string every fulfilment form already speaks.

import { HugeiconsIcon } from '@hugeicons/react';
import { CalendarDaysIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const LOCAL_VALUE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const DEFAULT_HOUR = 12;
const DEFAULT_MINUTE = 0;

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
};

function parseLocal(value: string): LocalParts | null {
  const match = LOCAL_VALUE.exec(value);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]) - 1,
    day: Number(match[3]),
    hours: Number(match[4]),
    minutes: Number(match[5]),
  };
}

function toLocalValue(parts: LocalParts): string {
  const month = String(parts.month + 1).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  const hours = String(parts.hours).padStart(2, '0');
  const minutes = String(parts.minutes).padStart(2, '0');
  return `${parts.year}-${month}-${day}T${hours}:${minutes}`;
}

function toDate(parts: Pick<LocalParts, 'year' | 'month' | 'day'>): Date {
  return new Date(parts.year, parts.month, parts.day);
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatTrigger(value: string): string {
  const parts = parseLocal(value);
  if (!parts) return 'Choose date and time';
  return new Date(parts.year, parts.month, parts.day, parts.hours, parts.minutes).toLocaleString(
    'en-AU',
    {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    },
  );
}

function formatSlot(hours: number, minutes: number): string {
  return new Date(2026, 0, 1, hours, minutes).toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function slotKey(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function buildSlots(current?: { hours: number; minutes: number }): Array<{
  key: string;
  hours: number;
  minutes: number;
  label: string;
}> {
  const slots: Array<{ key: string; hours: number; minutes: number; label: string }> = [];
  for (let hours = 7; hours <= 22; hours += 1) {
    for (const minutes of [0, 30]) {
      if (hours === 22 && minutes === 30) continue;
      slots.push({
        key: slotKey(hours, minutes),
        hours,
        minutes,
        label: formatSlot(hours, minutes),
      });
    }
  }
  if (
    current &&
    !slots.some((slot) => slot.hours === current.hours && slot.minutes === current.minutes)
  ) {
    slots.unshift({
      key: slotKey(current.hours, current.minutes),
      hours: current.hours,
      minutes: current.minutes,
      label: formatSlot(current.hours, current.minutes),
    });
  }
  return slots;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function slotIsPast(date: Date, hours: number, minutes: number): boolean {
  const now = new Date();
  if (!isSameDay(date, now)) return date < startOfToday();
  return hours < now.getHours() || (hours === now.getHours() && minutes <= now.getMinutes());
}

export interface DateTimePickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

/** Calendar + half-hour time list. Value is a `datetime-local` string. */
export function DateTimePicker({
  id,
  value,
  onChange,
  disabled = false,
  required = false,
  className,
}: DateTimePickerProps) {
  const parts = parseLocal(value);
  const selectedDate = parts ? toDate(parts) : undefined;
  const slots = buildSlots(parts ? { hours: parts.hours, minutes: parts.minutes } : undefined);
  const timeValue = parts ? slotKey(parts.hours, parts.minutes) : '';

  function applyDate(next: Date | undefined) {
    if (!next) return;
    const hours = parts?.hours ?? DEFAULT_HOUR;
    const minutes = parts?.minutes ?? DEFAULT_MINUTE;
    const candidate = { hours, minutes };
    const snapped = slotIsPast(next, candidate.hours, candidate.minutes)
      ? slots.find((slot) => !slotIsPast(next, slot.hours, slot.minutes)) ?? candidate
      : candidate;
    onChange(
      toLocalValue({
        year: next.getFullYear(),
        month: next.getMonth(),
        day: next.getDate(),
        hours: snapped.hours,
        minutes: snapped.minutes,
      }),
    );
  }

  function applyTime(next: string) {
    const [hours, minutes] = next.split(':').map(Number);
    const date = selectedDate ?? new Date();
    onChange(
      toLocalValue({
        year: date.getFullYear(),
        month: date.getMonth(),
        day: date.getDate(),
        hours,
        minutes,
      }),
    );
  }

  return (
    <div className={cn('grid gap-snug sm:grid-cols-[minmax(0,1fr)_10.5rem]', className)}>
      <Popover modal>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-required={required}
            className={cn(
              'h-10 w-full justify-start font-normal',
              !parts && 'text-muted-foreground',
            )}
          >
            <HugeiconsIcon icon={CalendarDaysIcon} data-icon="inline-start" aria-hidden />
            {formatTrigger(value)}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={applyDate}
            disabled={{ before: startOfToday() }}
            startMonth={startOfToday()}
          />
        </PopoverContent>
      </Popover>

      <Select
        value={timeValue}
        onValueChange={applyTime}
        disabled={disabled || !selectedDate}
      >
        <SelectTrigger aria-label="Meeting time">
          <SelectValue placeholder="Time" />
        </SelectTrigger>
        <SelectContent>
          {slots.map((slot) => (
            <SelectItem
              key={slot.key}
              value={slot.key}
              disabled={selectedDate ? slotIsPast(selectedDate, slot.hours, slot.minutes) : false}
            >
              {slot.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
