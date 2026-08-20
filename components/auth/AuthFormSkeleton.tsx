// components/auth/AuthFormSkeleton.tsx
//
// Suspense fallback for sign-in / sign-up while `useSearchParams` resolves.
// Matches AuthForm's Card geometry so the page never flashes blank.

import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';

export function AuthFormSkeleton() {
  return (
    <Card
      className="w-full max-w-md"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>
      <CardHeader className="items-center space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-10 w-full rounded-md" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
        <Skeleton className="h-10 w-full rounded-md" />
      </CardContent>
      <CardFooter className="justify-center">
        <Skeleton className="h-4 w-48" />
      </CardFooter>
    </Card>
  );
}
