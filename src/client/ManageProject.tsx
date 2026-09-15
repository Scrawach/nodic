import { useEffect, useState } from 'react';
import { api } from './api';
import type { Project } from '../shared/model';

export function ManageProject({
  project,
  dialogueId,
  enabled,
  close,
}: {
  project: Project;
  dialogueId: string;
  enabled: boolean;
  close: () => void;
}) {
  const dialogue = project.dialogues.find((d) => d.id === dialogueId)!;
  const [projectName, setProjectName] = useState(project.name);
  const [dialogueName, setDialogueName] = useState(dialogue.name);
  const [confirm, setConfirm] = useState<'project' | 'dialogue'>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setProjectName(project.name), [project.name]);
  useEffect(() => setDialogueName(dialogue.name), [dialogue.name]);
  async function change(path: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      await api(path, body);
      setConfirm(undefined);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-label="Управление проектом">
        <div className="modal-heading">
          <h2>Управление проектом</h2>
          <button onClick={close} aria-label="Закрыть">
            ×
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void change(`/projects/${project.id}/rename`, { name: projectName });
          }}
        >
          <label>
            Название проекта
            <input
              aria-label="Название проекта"
              maxLength={120}
              required
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </label>
          <button
            disabled={
              !enabled || busy || !projectName.trim() || projectName.trim() === project.name
            }
          >
            Переименовать проект
          </button>
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void change(`/dialogues/${dialogueId}/rename`, { name: dialogueName });
          }}
        >
          <label>
            Название диалога
            <input
              aria-label="Название диалога"
              maxLength={120}
              required
              value={dialogueName}
              onChange={(e) => setDialogueName(e.target.value)}
            />
          </label>
          <button
            disabled={
              !enabled || busy || !dialogueName.trim() || dialogueName.trim() === dialogue.name
            }
          >
            Переименовать диалог
          </button>
        </form>
        {project.role === 'owner' && (
          <div className="character-confirm">
            <button
              disabled={!enabled || busy || project.dialogues.length <= 1}
              onClick={() => setConfirm('dialogue')}
            >
              Удалить диалог
            </button>
            <button disabled={!enabled || busy} onClick={() => setConfirm('project')}>
              Удалить проект
            </button>
            {project.dialogues.length <= 1 && (
              <p>Последний диалог удалить нельзя. Можно удалить проект целиком.</p>
            )}
          </div>
        )}
        {confirm && (
          <div role="group" aria-label="Подтверждение удаления">
            <p>
              {confirm === 'project'
                ? `Удалить проект «${project.name}» со всеми диалогами?`
                : `Удалить диалог «${dialogue.name}»?`}{' '}
              Это действие нельзя отменить.
            </p>
            <button
              disabled={!enabled || busy}
              onClick={() =>
                void change(
                  confirm === 'project'
                    ? `/projects/${project.id}/delete`
                    : `/dialogues/${dialogueId}/delete`,
                  {},
                )
              }
            >
              Подтвердить удаление
            </button>
            <button onClick={() => setConfirm(undefined)}>Отмена</button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </div>
  );
}
