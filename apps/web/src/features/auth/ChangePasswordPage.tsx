import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ApiError, errorMessage } from '@/lib/api';
import { applyApiFieldErrors } from '@/lib/form-errors';
import { useChangePassword, useCurrentUser } from './auth-api';

export const PASSWORD_MIN_LENGTH = 12;

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual'),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `A nova senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres`)
      .max(128, 'Máximo de 128 caracteres'),
    confirmation: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmation, {
    path: ['confirmation'],
    message: 'A confirmação não confere',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'A nova senha deve ser diferente da atual',
  });
type Form = z.infer<typeof schema>;

export function ChangePasswordPage() {
  const { data: user } = useCurrentUser();
  const change = useChangePassword();
  const navigate = useNavigate();
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmation: '' },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      await change.mutateAsync({ currentPassword, newPassword });
      toast.success('Senha alterada. As demais sessões foram encerradas.');
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong-current-password') {
        form.setError('currentPassword', { message: 'Senha atual incorreta' });
      } else {
        applyApiFieldErrors(err, form.setError, ['currentPassword', 'newPassword']);
      }
    }
  });

  const generalError =
    change.isError &&
    !(
      change.error instanceof ApiError &&
      ['wrong-current-password', 'validation-error'].includes(change.error.code)
    )
      ? errorMessage(change.error)
      : null;

  return (
    <div className="mx-auto w-full max-w-md py-8">
      <Card>
        <CardHeader>
          <CardTitle>Trocar senha</CardTitle>
          <CardDescription>
            {user?.mustChangePassword
              ? 'Sua senha é temporária. Defina uma nova senha para continuar.'
              : `Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {generalError && <Alert variant="destructive" title={generalError} />}
            <FormField label="Senha atual" error={errors.currentPassword?.message} required>
              <Input
                type="password"
                autoComplete="current-password"
                {...form.register('currentPassword')}
              />
            </FormField>
            <FormField
              label="Nova senha"
              error={errors.newPassword?.message}
              hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`}
              required
            >
              <Input
                type="password"
                autoComplete="new-password"
                {...form.register('newPassword')}
              />
            </FormField>
            <FormField label="Confirme a nova senha" error={errors.confirmation?.message} required>
              <Input
                type="password"
                autoComplete="new-password"
                {...form.register('confirmation')}
              />
            </FormField>
            <Button type="submit" className="w-full" loading={change.isPending}>
              Salvar nova senha
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
