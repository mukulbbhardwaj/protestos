import { APP_CONFIG } from '@app/shared';
import { Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Logo({ className, withName = true }: { className?: string; withName?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <Landmark className="size-4" />
      </span>
      {withName && <span>{APP_CONFIG.displayName}</span>}
    </span>
  );
}
