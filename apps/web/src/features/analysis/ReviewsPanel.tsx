import { zodResolver } from '@hookform/resolvers/zod';
import { ReviewRecommendation } from '@creditflow/shared';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ErrorState } from '@/app/pages/ErrorState';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { Application } from '@/features/applications/applications-api';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { applyApiFieldErrors } from '@/lib/form-errors';
import { RECOMMENDATION_LABELS } from '@/lib/labels';
import { useCreateReview, useReviews } from './analysis-api';
import { MIN_JUSTIFICATION } from './constants';
import { useAnalysisAccess } from './use-analysis-access';

const schema = z.object({
  recommendation: z.enum(
    Object.values(ReviewRecommendation) as [ReviewRecommendation, ...ReviewRecommendation[]],
    { message: 'Selecione a recomendação' },
  ),
  analysisNotes: z.string().trim().min(10, 'Descreva a análise (mín. 10 caracteres)').max(5000),
  justification: z
    .string()
    .trim()
    .min(MIN_JUSTIFICATION, `A justificativa deve ter ao menos ${MIN_JUSTIFICATION} caracteres`)
    .max(5000),
});
type Form = z.infer<typeof schema>;

/** Pareceres: append-only; the latest one is the current review. */
export function ReviewsPanel({ application }: { application: Application }) {
  const reviews = useReviews(application.id);
  const { canAnalyse } = useAnalysisAccess(application);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pareceres</CardTitle>
        <CardDescription>
          Cada novo parecer substitui o anterior como vigente; o histórico é mantido.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canAnalyse && <ReviewForm applicationId={application.id} />}
        {reviews.isPending ? (
          <Spinner />
        ) : reviews.isError ? (
          <ErrorState error={reviews.error} />
        ) : reviews.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum parecer registrado.</p>
        ) : (
          <ol className="space-y-3">
            {reviews.data.map((r) => (
              <li
                key={r.id}
                className={
                  r.current
                    ? 'rounded-md border border-primary/40 p-3'
                    : 'rounded-md border p-3 opacity-80'
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={r.current ? 'default' : 'secondary'}>
                    {r.current ? 'Vigente' : 'Anterior'}
                  </Badge>
                  <span className="text-sm font-medium">
                    Recomendação: {RECOMMENDATION_LABELS[r.recommendation]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.author.name} · {formatDateTime(r.createdAt)}
                  </span>
                </div>
                <p className="mt-2 text-sm whitespace-pre-line">{r.analysisNotes}</p>
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">Justificativa: </span>
                  {r.justification}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewForm({ applicationId }: { applicationId: string }) {
  const create = useCreateReview(applicationId);
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      recommendation: '' as ReviewRecommendation,
      analysisNotes: '',
      justification: '',
    },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values);
      toast.success('Parecer registrado.');
      form.reset();
    } catch (err) {
      applyApiFieldErrors(err, form.setError, ['recommendation', 'analysisNotes', 'justification']);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3 rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">Novo parecer</p>
      {create.isError && <Alert variant="destructive" title={errorMessage(create.error)} />}
      <FormField label="Recomendação" error={errors.recommendation?.message} required>
        <Select {...form.register('recommendation')}>
          <option value="">Selecione…</option>
          {Object.entries(RECOMMENDATION_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Observações da análise" error={errors.analysisNotes?.message} required>
        <Textarea rows={4} {...form.register('analysisNotes')} />
      </FormField>
      <FormField
        label="Justificativa"
        error={errors.justification?.message}
        hint={`Mínimo de ${MIN_JUSTIFICATION} caracteres.`}
        required
      >
        <Textarea rows={3} {...form.register('justification')} />
      </FormField>
      <Button type="submit" size="sm" loading={create.isPending}>
        Registrar parecer
      </Button>
    </form>
  );
}
