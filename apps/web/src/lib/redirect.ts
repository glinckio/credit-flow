/** Only same-app relative paths are accepted as post-login destinations (no open redirect). */
export function safeRedirect(target: string | null): string {
  return target && target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')
    ? target
    : '/';
}
