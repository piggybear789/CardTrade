import type { ReactNode } from 'react';

import { MarketingFooter } from './marketing-footer';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-backdrop flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col">{children}</div>
      {/* Client, for its one path check: hidden on phones on the references pages. */}
      <MarketingFooter />
    </div>
  );
}
