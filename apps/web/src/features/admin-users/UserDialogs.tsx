import { zodResolver } from '@hookform/resolvers/zod';
import { ROLES, Role } from '@creditflow/shared';
import { Copy, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError, errorMessage } from '@/lib/api';
import { applyApiFieldErrors } from '@/lib/form-errors';
import { ROLE_LABELS } from '@/lib/labels';
import {
  type AdminUser,
  generateTemporaryPassword,
  useCreateUser,
  useResetPassword,
  useUpdateUser,
} from './users-api';

const PASSWORD_MIN = 12;

function PasswordField({
  value,
  onChange,
  error,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  label: string;
}) {
  // The label must point at the <input> itself, so the action buttons sit
  // beside the FormField instead of inside it.
  return (
    <div className="flex items-start gap-2">
      <FormField
        label={label}
        error={error}
        hint={`Mínimo de ${PASSWORD_MIN} caracteres. O usuário deverá trocá-la no primeiro acesso.`}
        required
        className="flex-1"
      >
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          className="font-mono"
        />
      </FormField>
      <div className="mt-6 flex gap-2">
        <Button
          variant="outline"
          size="icon"
          title="Gerar senha"
          aria-label="Gerar senha"
          onClick={() => onChange(generateTemporaryPassword())}
        >
          <RefreshCw />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="Copiar"
          aria-label="Copiar senha"
          onClick={() =>
            void navigator.clipboard?.writeText(value).then(() => toast.success('Senha copiada.'))
          }
          disabled={!value}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

const createSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome').max(120),
    email: z.string().trim().min(1, 'Informe o e-mail').email('Informe um e-mail válido'),
    role: z.enum(ROLES as [Role, ...Role[]], { message: 'Selecione o papel' }),
    canDecide: z.boolean(),
    initialPassword: z.string().min(PASSWORD_MIN, `Mínimo de ${PASSWORD_MIN} caracteres`).max(128),
  })
  .refine((v) => !v.canDecide || v.role === Role.OPERATOR, {
    path: ['canDecide'],
    message: 'Somente operadores recebem a permissão de decisão',
  });
type CreateForm = z.infer<typeof createSchema>;

export function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateUser();
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: '',
      email: '',
      role: Role.ANALYST,
      canDecide: false,
      initialPassword: '',
    },
  });
  const role = useWatch({ control: form.control, name: 'role' });
  const password = useWatch({ control: form.control, name: 'initialPassword' });
  const { errors } = form.formState;

  const close = () => {
    form.reset();
    create.reset();
    onClose();
  };
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync({
        ...values,
        email: values.email.toLowerCase(),
        canDecide: values.role === Role.OPERATOR && values.canDecide,
      });
      toast.success('Usuário criado. Entregue a senha temporária por um canal seguro.');
      close();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email-already-used') {
        form.setError('email', { message: 'Já existe um usuário com este e-mail' });
      } else {
        applyApiFieldErrors(err, form.setError, [
          'name',
          'email',
          'role',
          'canDecide',
          'initialPassword',
        ]);
      }
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Novo usuário"
      description="O usuário entra com a senha temporária e é obrigado a trocá-la."
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancelar
          </Button>
          <Button onClick={() => void onSubmit()} loading={create.isPending}>
            Criar usuário
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        {create.isError &&
          !(
            create.error instanceof ApiError &&
            ['email-already-used', 'validation-error'].includes(create.error.code)
          ) && <Alert variant="destructive" title={errorMessage(create.error)} />}
        <FormField label="Nome" error={errors.name?.message} required>
          <Input {...form.register('name')} />
        </FormField>
        <FormField label="E-mail" error={errors.email?.message} required>
          <Input type="email" autoComplete="off" {...form.register('email')} />
        </FormField>
        <FormField label="Papel" error={errors.role?.message} required>
          <Select {...form.register('role', { onChange: () => form.setValue('canDecide', false) })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </FormField>
        {role === Role.OPERATOR && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" {...form.register('canDecide')} />
            Pode registrar decisões de crédito (concessão explícita)
          </label>
        )}
        {role === Role.ADMIN && (
          <p className="text-xs text-muted-foreground">
            Administradores não registram decisões de crédito (segregação de funções).
          </p>
        )}
        <PasswordField
          label="Senha temporária"
          value={password}
          onChange={(v) =>
            form.setValue('initialPassword', v, { shouldValidate: form.formState.isSubmitted })
          }
          error={errors.initialPassword?.message}
        />
      </form>
    </Dialog>
  );
}

export function EditUserDialog({
  user,
  isSelf,
  onClose,
}: {
  user: AdminUser | null;
  isSelf: boolean;
  onClose: () => void;
}) {
  const update = useUpdateUser();
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>(Role.ANALYST);
  const [canDecide, setCanDecide] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (user && loadedFor !== user.id) {
    setLoadedFor(user.id);
    setName(user.name);
    setRole(user.role);
    setCanDecide(user.canDecide);
  }

  const close = () => {
    setLoadedFor(null);
    update.reset();
    onClose();
  };
  const save = async () => {
    if (!user) return;
    try {
      await update.mutateAsync({
        id: user.id,
        name: name.trim(),
        ...(isSelf ? {} : { role }),
        canDecide: role === Role.OPERATOR && canDecide,
      });
      toast.success('Usuário atualizado. As permissões valem a partir da próxima ação dele.');
      close();
    } catch {
      // shown in the dialog
    }
  };

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(o) => !o && close()}
      title={`Editar ${user?.name ?? ''}`}
      description={user?.email}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancelar
          </Button>
          <Button
            onClick={() => void save()}
            loading={update.isPending}
            disabled={name.trim().length < 2}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {update.isError && <Alert variant="destructive" title={errorMessage(update.error)} />}
        <FormField label="Nome" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField
          label="Papel"
          hint={isSelf ? 'Você não pode alterar o próprio papel.' : undefined}
        >
          <Select
            value={role}
            disabled={isSelf}
            onChange={(e) => {
              setRole(e.target.value as Role);
              setCanDecide(false);
            }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </FormField>
        {role === Role.OPERATOR && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={canDecide}
              onChange={(e) => setCanDecide(e.target.checked)}
            />
            Pode registrar decisões de crédito (concessão explícita)
          </label>
        )}
      </div>
    </Dialog>
  );
}

export function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: AdminUser | null;
  onClose: () => void;
}) {
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setPassword('');
    setError(null);
    reset.reset();
    onClose();
  };
  const confirm = async () => {
    if (!user) return;
    if (password.length < PASSWORD_MIN) {
      setError(`Mínimo de ${PASSWORD_MIN} caracteres`);
      return;
    }
    try {
      await reset.mutateAsync({ id: user.id, temporaryPassword: password });
      toast.success('Senha redefinida. As sessões do usuário foram encerradas.');
      close();
    } catch {
      // shown in the dialog
    }
  };

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(o) => !o && close()}
      title={`Redefinir senha — ${user?.name ?? ''}`}
      description="Todas as sessões ativas do usuário serão encerradas e a troca de senha será exigida."
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancelar
          </Button>
          <Button onClick={() => void confirm()} loading={reset.isPending}>
            Redefinir
          </Button>
        </>
      }
    >
      {reset.isError && (
        <Alert variant="destructive" title={errorMessage(reset.error)} className="mb-3" />
      )}
      <PasswordField
        label="Nova senha temporária"
        value={password}
        onChange={setPassword}
        error={error ?? undefined}
      />
    </Dialog>
  );
}
