import { ShieldX } from 'lucide-react';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button';

export function ForbiddenPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <ShieldX className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">Acesso negado</h1>
      <p className="text-sm text-muted-foreground">
        Seu perfil não tem permissão para acessar esta área. Se precisar, fale com um administrador.
      </p>
      <Link to="/" className={buttonVariants({ variant: 'outline' })}>
        Voltar ao início
      </Link>
    </div>
  );
}
