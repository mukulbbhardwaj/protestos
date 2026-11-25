import { SearchX } from 'lucide-react';
import { TableCell, TableRow } from '@/components/ui/table';

export function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="py-14 text-center text-sm text-muted-foreground">
        <SearchX className="mx-auto mb-2 size-5" />
        {message}
      </TableCell>
    </TableRow>
  );
}
