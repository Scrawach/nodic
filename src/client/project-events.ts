import { entries, del, update } from 'idb-keyval';

// Only a server receipt authenticated by this project's original session is
// evidence of deletion. Network failures and denied/expired access retain data.
export async function checkRemoved(dialogueId?: string) {
  const projectId = location.pathname.match(/^\/p\/([^/]+)/)?.[1];
  if (!projectId) return false;
  try {
    const response = await fetch(`/api/projects/${projectId}/removals`);
    if (!response.ok) return false;
    const receipt = await response.json();
    if (receipt.projectDeleted || (dialogueId && receipt.dialogueIds.includes(dialogueId))) {
      await leaveRemoved(projectId, receipt.dialogueIds, receipt.projectDeleted);
      return true;
    }
  } catch {
    // Preserve the outbox until authoritative recovery is possible.
  }
  return false;
}

export function renameRecent(projectId: string, name: string) {
  try {
    const recent = JSON.parse(localStorage.getItem('nodic-projects') || '[]');
    localStorage.setItem(
      'nodic-projects',
      JSON.stringify(recent.map((p: { id: string }) => (p.id === projectId ? { ...p, name } : p))),
    );
  } catch {
    /* Storage may be unavailable; server state remains authoritative. */
  }
}
export async function leaveRemoved(
  projectId: string,
  dialogueIds: string[],
  projectDeleted: boolean,
) {
  const notice = projectDeleted ? 'Проект удалён владельцем.' : 'Диалог удалён владельцем.';
  try {
    sessionStorage.setItem('nodic-notice', notice);
    if (projectDeleted) {
      const recent = JSON.parse(localStorage.getItem('nodic-projects') || '[]');
      localStorage.setItem(
        'nodic-projects',
        JSON.stringify(recent.filter((p: { id: string }) => p.id !== projectId)),
      );
    }
    const tab = sessionStorage.getItem('nodic-tab');
    const prefixes = dialogueIds.map((id) => `nodic:${tab}:${id}:`);
    const stored = await entries<string, unknown>();
    await Promise.all(
      stored
        .filter(
          ([key]) => typeof key === 'string' && prefixes.some((prefix) => key.startsWith(prefix)),
        )
        .map(([key]) => del(key)),
    );
    await update<Array<{ path: string }>>('nodic-http-creations-v1', (items = []) =>
      items.filter(
        (item) =>
          !(projectDeleted && item.path.startsWith(`/projects/${projectId}/`)) &&
          !dialogueIds.some((id) => item.path.startsWith(`/dialogues/${id}/`)),
      ),
    );
  } finally {
    const directory = location.pathname.endsWith('/characters');
    location.replace(projectDeleted ? '/' : `/p/${projectId}${directory ? '/characters' : ''}`);
  }
}
export function takeNotice() {
  const notice = sessionStorage.getItem('nodic-notice') || '';
  sessionStorage.removeItem('nodic-notice');
  return notice;
}
