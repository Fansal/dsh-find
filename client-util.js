export function resolveProjectPath(sessionCtx) {
  if (!sessionCtx || typeof sessionCtx !== 'object') return null
  const wp = sessionCtx.workspace?.path
  if (typeof wp === 'string' && wp) return wp
  const cwd = sessionCtx.session?.cwd
  if (typeof cwd === 'string' && cwd) return cwd
  return null
}
