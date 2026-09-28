/** Electron invoke 抛错带 "Error invoking remote method 'x': Error: " 前缀，剥掉只留正文。 */
export function ipcErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
}
