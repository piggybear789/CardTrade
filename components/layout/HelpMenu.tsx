'use client';

// The guest header's "?" menu: what protects a purchase, how to stay safe, and help.
//
// A guest deciding whether to trust a marketplace has those questions BEFORE they
// sign up, and the only routes to the answers were inside the member's account menu.
// Members reach the same pages from that menu and the Account hub, so this is
// guest-only.

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { HelpCircleIcon, LockIcon, ShieldCheckIcon } from '@hugeicons/core-free-icons';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const ROWS = [
  { href: '/help#holds', label: 'Purchase protection', icon: LockIcon },
  { href: '/safety', label: 'Staying safe', icon: ShieldCheckIcon },
  { href: '/help', label: 'Help centre', icon: HelpCircleIcon },
] as const;

export function HelpMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Help"
        className="inline-flex size-10 touch-manipulation items-center justify-center rounded-md border border-transparent text-mist/75 transition-colors hover:bg-white/10 hover:text-mist focus:outline-none focus-visible:border-iris data-[state=open]:bg-white/10"
      >
        <HugeiconsIcon icon={HelpCircleIcon} className="size-5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {ROWS.map((row) => (
          <DropdownMenuItem key={row.href} asChild>
            <Link href={row.href}>
              <HugeiconsIcon icon={row.icon} aria-hidden />
              {row.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
