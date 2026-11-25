import { cn, initials } from '@/lib/utils';

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
