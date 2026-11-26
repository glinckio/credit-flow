import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export function Pagination({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(meta.total / meta.pageSize));
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.total, meta.page * meta.pageSize);
  return (
    <nav aria-label="Paginação" className="mt-3 flex items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">
        {meta.total === 0 ? 'Nenhum registro' : `${from}–${to} de ${meta.total}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPage(meta.page - 1)}
          disabled={meta.page <= 1}
          aria-label="Página anterior"
        >
          <ChevronLeft />
        </Button>
        <span className="text-muted-foreground">
          Página {meta.page} de {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPage(meta.page + 1)}
          disabled={meta.page >= pages}
          aria-label="Próxima página"
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
