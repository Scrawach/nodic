import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import { takeNotice } from './project-events';
import { DialogueSession } from './session';
import { characterColors, type Character, type Project } from '../shared/model';

export function CharacterRow({
  character,
  projectId,
  enabled,
  refresh,
}: {
  character: Character;
  projectId: string;
  enabled: boolean;
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState(character.name);
  const [color, setColor] = useState(character.color);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setName(character.name), [character.name]);
  useEffect(() => setColor(character.color), [character.color]);
  async function change(action: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      await api(`/projects/${projectId}/characters/${character.id}/${action}`, body);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="character-card" aria-label={character.name}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void change('rename', { name });
        }}
      >
        <label>
          Имя персонажа
          <input
            aria-label="Имя персонажа"
            required
            maxLength={120}
            value={name}
            disabled={!enabled || busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button disabled={!enabled || busy || !name.trim() || name.trim() === character.name}>
          Сохранить имя
        </button>
      </form>
      <div className="button-row">
        <label>
          Цвет персонажа
          <input
            aria-label="Цвет персонажа"
            type="color"
            value={color}
            disabled={!enabled || busy}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <button
          disabled={!enabled || busy || color === character.color}
          onClick={() => void change('color', { color })}
        >
          Сохранить цвет
        </button>
        <button disabled={!enabled || busy} onClick={() => setConfirm(true)}>
          Удалить персонажа
        </button>
      </div>
      {confirm && (
        <div className="character-confirm">
          <p>
            Удалить «{character.name}» из проекта? Текст реплик сохранится; вместо имени появится
            «Неизвестный персонаж».
          </p>
          <button disabled={!enabled || busy} onClick={() => void change('delete', {})}>
            Подтвердить удаление
          </button>
          <button onClick={() => setConfirm(false)}>Отмена</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

export function CharacterCreate({
  projectId,
  enabled,
  created,
}: {
  projectId: string;
  enabled: boolean;
  created: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(characterColors[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="character-card character-create"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        void api(`/projects/${projectId}/characters`, { name, color })
          .then(async () => {
            setName('');
            await created();
          })
          .catch((e) => setError(String(e)))
          .finally(() => setBusy(false));
      }}
    >
      <h2>Новый персонаж</h2>
      <label>
        Имя нового персонажа
        <input
          aria-label="Имя нового персонажа"
          value={name}
          maxLength={120}
          required
          disabled={!enabled || busy}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Цвет нового персонажа
        <input
          aria-label="Цвет нового персонажа"
          type="color"
          value={color}
          disabled={!enabled || busy}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
      <button disabled={!enabled || busy || !name.trim()}>Создать персонажа</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function Characters({ project: initial }: { project: Project }) {
  const [project, setProject] = useState(initial);
  const [session] = useState(() => new DialogueSession(initial.dialogues[0].id, false));
  const live = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [error, setError] = useState(takeNotice);
  const refresh = async () => setProject(await api<Project>(`/projects/${initial.id}`));
  useEffect(() => {
    let cancelled = false;
    void api<Project>(`/projects/${initial.id}`)
      .then((value) => {
        if (!cancelled) setProject(value);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [initial.id, live.projectVersion]);
  useEffect(() => () => session.destroy(), [session]);
  return (
    <main className="characters-page">
      <header>
        <a href={`/p/${project.id}`}>← К диалогам</a>
        <h1>Персонажи</h1>
        <p>{project.name} · Общий справочник проекта</p>
      </header>
      {!live.connected && <p role="status">Нет соединения. Изменения приостановлены.</p>}
      <CharacterCreate projectId={project.id} enabled={live.connected} created={refresh} />
      {error && <p role="alert">{error}</p>}
      {!project.characters.length && <p>Персонажей пока нет. Создайте первого выше.</p>}
      {project.characters.map((character) => (
        <CharacterRow
          key={character.id}
          character={character}
          projectId={project.id}
          enabled={live.connected}
          refresh={refresh}
        />
      ))}
    </main>
  );
}
