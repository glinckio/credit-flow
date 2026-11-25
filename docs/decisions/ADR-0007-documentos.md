# ADR-0007 — Armazenamento e validação de documentos

- **Status:** Aceito
- **Data:** 25/11/2026
- **Detalha:** D15 e D16 do plano; requisitos de segurança da seção 4.4 do roadmap

## Decisão

1. **Porta `DocumentStorage`** (`put`, `open`, `remove`) com adaptador **`LocalFsStorage`**. Raiz em `STORAGE_DIR` (padrão `var/storage`, relativo à raiz do repositório, gitignored, fora de qualquer pasta pública). Testes usam `var/storage-test`, apagado no início de cada execução.
2. **Chaves opacas** `documents/<uuid>` geradas pelo servidor; arquivo gravado **sem extensão**, permissão `0600`, escrita atômica (temp + rename). Nenhuma entrada do usuário chega ao caminho; o adaptador recusa qualquer chave fora do padrão e qualquer caminho que saia da raiz.
3. **Validação antes de gravar**, com upload em memória (multer, limite de 10 MB, 1 arquivo):
   - tipo detectado por **assinatura** (`%PDF-`, PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`); MIME informado pelo navegador é ignorado;
   - extensão do nome deve corresponder ao conteúdo (`415 file-extension-mismatch`), formatos fora da lista → `415 unsupported-file-type`, vazio → `400`, acima do limite → `413`;
   - nome original guardado só para exibição, sem diretórios, caracteres de controle ou pontuação perigosa; `defParamCharset: utf8` preserva acentos.
   - Dependência `file-type` descartada: ESM com binários de detecção amplos, desnecessária para 3 assinaturas.
4. **Download somente por endpoint autorizado**, sempre `Content-Disposition: attachment` (RFC 6266/5987), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'; sandbox`. Cada download gera evento `document.downloaded` (trilha de acesso a dados pessoais).
5. **Consistência arquivo × banco**: grava o arquivo, depois metadados + auditoria em transação; se a transação falhar, o arquivo é removido (compensação). A edição revalida status dentro da transação.
6. **Regras de negócio**: incluir/remover apenas em `DRAFT`/`PENDING_INFORMATION`; máximo 30 documentos ativos por solicitação; validação manual (`ACCEPTED`/`REJECTED`/`PENDING`) só pelo analista responsável durante a análise; rejeição exige observação; remoção é **lógica** (`deletedAt`) e o arquivo é mantido para retenção — remoção física fica para a anonimização.
7. **Visibilidade** herdada da solicitação: documentos de rascunho também respondem 404 para analistas.

## Limites conhecidos

- Sem antivírus nem sanitização de PDF (PDF válido pode conter JavaScript). Mitigação: nunca servido inline, CSP `sandbox`, `nosniff`. Em produção, avaliar varredura assíncrona antes de liberar o download.
- Integridade (SHA-256) gravada no upload, mas não reverificada a cada download.
