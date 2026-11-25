import { zodResolver } from '@hookform/resolvers/zod';
import { APP_NAME } from '@creditflow/shared';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ApiError, errorMessage } from '@/lib/api';
import { safeRedirect } from '@/lib/redirect';
import { useCurrentUser, useLogin } from './auth-api';

const schema = z.object({
  email: z.string().trim().min(1, 'Informe o e-mail').email('Informe um e-mail válido'),
  password: z.string().min(1, 'Informe a senha'),
});
type LoginForm = z.infer<typeof schema>;

function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === 'invalid-credentials') {
    return 'E-mail ou senha inválidos.';
  }
  if (err instanceof ApiError && err.status === 429) {
    return 'Muitas tentativas. Aguarde um minuto e tente novamente.';
  }
  return errorMessage(err);
}

export function LoginPage() {
  const { data: user } = useCurrentUser();
  const login = useLogin();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = safeRedirect(params.get('redirect'));

  const form = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  if (user) return <Navigate to={redirectTo} replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      navigate(redirectTo, { replace: true });
    } catch {
      form.resetField('password');
    }
  });

  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="text-sm text-muted-foreground">Gestão e análise manual de crédito</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Entrar</CardTitle>
            <CardDescription>Use as credenciais fornecidas pelo administrador.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              {login.isError && (
                <Alert variant="destructive" title={loginErrorMessage(login.error)} />
              )}
              <FormField label="E-mail" error={form.formState.errors.email?.message} required>
                <Input type="email" autoComplete="username" autoFocus {...form.register('email')} />
              </FormField>
              <FormField label="Senha" error={form.formState.errors.password?.message} required>
                <Input
                  type="password"
                  autoComplete="current-password"
                  {...form.register('password')}
                />
              </FormField>
              <Button type="submit" className="w-full" loading={login.isPending}>
                Entrar
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Ambiente de demonstração com dados sintéticos.
        </p>
      </div>
    </main>
  );
}
