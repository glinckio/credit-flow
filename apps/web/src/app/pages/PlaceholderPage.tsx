import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';

/** Temporary screen for areas delivered in later stages of Part A. */
export function PlaceholderPage({ title, stage }: { title: string; stage: number }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <Construction className="size-5" aria-hidden />
          Tela prevista para a Etapa {stage} do plano. A API correspondente já está disponível.
        </CardContent>
      </Card>
    </>
  );
}
