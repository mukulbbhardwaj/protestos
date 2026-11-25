import * as React from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}
export const TableHeader = (p: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead {...p} className={cn('[&_tr]:border-b', p.className)} />
);
export const TableBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody {...p} className={cn('[&_tr:last-child]:border-0', p.className)} />
);
export const TableRow = (p: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr {...p} className={cn('border-b transition-colors hover:bg-muted/40', p.className)} />
);
export const TableHead = (p: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    {...p}
    className={cn(
      'h-10 px-4 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground',
      p.className,
    )}
  />
);
export const TableCell = (p: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td {...p} className={cn('px-4 py-3 align-middle', p.className)} />
);
