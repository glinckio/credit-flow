import { SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <SearchX className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">Página não encontrada</h1>
      <p className="text-sm text-muted-foreground">
        O endereço não existe ou o registro não está disponível para o seu perfil.
      </p>
      <Link to="/" className={buttonVariants({ variant: 'outline' })}>
        Voltar ao início
      </Link>
    </div>
  );
}
