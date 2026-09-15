import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { yCollab } from 'y-codemirror.next';
import type { DialogueSession } from './session';
import { characterColors, type Project, type Character } from '../shared/model';
import { api } from './api';

const editability = (enabled: boolean) => [
  EditorView.editable.of(enabled),
  EditorState.readOnly.of(!enabled),
  EditorView.contentAttributes.of({ 'aria-readonly': String(!enabled) }),
];

export function TextEditor({
  session,
  nodeId,
  close,
  project,
  onCharacterChanged,
}: {
  session: DialogueSession;
  nodeId: string;
  close: () => void;
  project: Project;
  onCharacterChanged: (character: Character) => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [addingCharacter, setAddingCharacter] = useState(false);
  const [characterName, setCharacterName] = useState('');
  const [newColor, setNewColor] = useState(
    characterColors.find((color) => !project.characters.some((c) => c.color === color)) ||
      characterColors[0],
  );
  const [colorDraft, setColorDraft] = useState(characterColors[0]);
  const [savingColor, setSavingColor] = useState(false);
  const [characterError, setCharacterError] = useState('');
  const [creating, setCreating] = useState(false);
  const node = state.nodes.find((n) => n.id === nodeId);
  const character = project.characters.find((c) => c.id === node?.characterId);
  useEffect(() => {
    if (character) setColorDraft(character.color);
  }, [character?.id, character?.color]);
  const [handle] = useState(() => session.openText(nodeId));
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const [editable] = useState(() => new Compartment());
  const enabled = session.canEdit(handle);
  useEffect(() => {
    if (!handle.loaded || !host.current || view.current) return;
    const name =
      sessionStorage.getItem('nodic-name') || `Автор ${String(handle.doc.clientID).slice(-3)}`;
    handle.awareness.setLocalState({ user: { name, color: '#b97946', colorLight: '#b9794633' } });
    handle.undo.stopCapturing();
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: handle.doc.getText('text').toString(),
        extensions: [
          editable.of(editability(enabled)),
          EditorView.contentAttributes.of({
            'aria-label': 'Текст реплики',
            role: 'textbox',
            'aria-multiline': 'true',
          }),
          yCollab(handle.doc.getText('text'), handle.awareness, { undoManager: handle.undo }),
          keymap.of(defaultKeymap),
          EditorView.lineWrapping,
          EditorView.theme({
            '&': { minHeight: '240px', fontSize: '18px' },
            '.cm-content': { padding: '16px', lineHeight: '1.7', fontFamily: 'inherit' },
            '&.cm-focused': { outline: 'none' },
          }),
        ],
      }),
    });
    view.current = editor;
    editor.focus();
  }, [handle, handle.loaded, editable, enabled]);
  useEffect(() => {
    view.current?.dispatch({ effects: editable.reconfigure(editability(enabled)) });
  }, [editable, enabled]);
  useEffect(
    () => () => {
      view.current?.destroy();
      handle.undo.stopCapturing();
      handle.awareness.setLocalState(null);
    },
    [handle],
  );
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        className="modal editor-modal"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">РЕПЛИКА</span>
            <h2 id="editor-title">Слова, которые меняют историю</h2>
          </div>
          <button className="icon-button" onClick={close} aria-label="Закрыть">
            ×
          </button>
        </div>
        <div className="editor-meta">
          {node?.kind === 'line' ? (
            <div className="character-controls">
              <label>
                Персонаж
                <select
                  aria-label="Персонаж"
                  disabled={!session.canMove()}
                  value={node.characterMissing ? '__missing' : node.characterId || ''}
                  onChange={(event) =>
                    session.command({
                      type: 'set-character',
                      operationId: crypto.randomUUID(),
                      nodeId,
                      characterId: event.target.value || null,
                    })
                  }
                >
                  {node.characterMissing && (
                    <option value="__missing" disabled>
                      Неизвестный персонаж
                    </option>
                  )}
                  <option value="">Без персонажа</option>
                  {project.characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {character && (
                <div className="character-color-controls">
                  <label>
                    Цвет персонажа
                    <input
                      type="color"
                      aria-label="Цвет персонажа"
                      value={colorDraft}
                      disabled={!session.canMove() || savingColor}
                      onChange={(e) => setColorDraft(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={!session.canMove() || savingColor || colorDraft === character.color}
                    onClick={() => {
                      setSavingColor(true);
                      setCharacterError('');
                      void api<Character>(
                        `/projects/${project.id}/characters/${character.id}/color`,
                        { color: colorDraft },
                      )
                        .then(onCharacterChanged)
                        .catch((e) => setCharacterError(e.message))
                        .finally(() => setSavingColor(false));
                    }}
                  >
                    {savingColor ? 'Сохраняем…' : 'Сохранить цвет'}
                  </button>
                </div>
              )}
              <button
                disabled={!session.canMove()}
                onClick={() => {
                  setNewColor(
                    characterColors.find(
                      (color) => !project.characters.some((c) => c.color === color),
                    ) || characterColors[project.characters.length % characterColors.length],
                  );
                  setAddingCharacter((v) => !v);
                }}
              >
                ＋ Новый персонаж
              </button>
            </div>
          ) : (
            <span>Выбор игрока</span>
          )}
          <span data-testid="editor-presence">
            В редакторе: {handle.awareness.getStates().size}
          </span>
        </div>
        {addingCharacter && (
          <form
            className="character-form"
            onSubmit={(event) => {
              event.preventDefault();
              setCreating(true);
              setCharacterError('');
              void api<Character>(`/projects/${project.id}/characters`, {
                name: characterName,
                color: newColor,
              })
                .then((character) => {
                  onCharacterChanged(character);
                  session.command({
                    type: 'set-character',
                    operationId: crypto.randomUUID(),
                    nodeId,
                    characterId: character.id,
                  });
                  setAddingCharacter(false);
                  setCharacterName('');
                })
                .catch((e) => setCharacterError(e.message))
                .finally(() => setCreating(false));
            }}
          >
            <label>
              Имя персонажа
              <input
                autoFocus
                required
                maxLength={120}
                value={characterName}
                onChange={(e) => setCharacterName(e.target.value)}
              />
            </label>
            <label>
              Цвет нового персонажа
              <input
                type="color"
                aria-label="Цвет нового персонажа"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
              />
            </label>
            <button disabled={creating || !characterName.trim() || !session.canMove()}>
              Создать персонажа
            </button>
          </form>
        )}
        {characterError && <p role="alert">{characterError}</p>}
        {!handle.loaded && <p className="muted">Подключаем редактор…</p>}
        <div ref={host} className="text-editor" />
        <footer className="editor-footer">
          <div className="button-row">
            <button disabled={!session.canUndo()} onClick={() => session.undo()}>
              Отменить
            </button>
            <button disabled={!session.canRedo()} onClick={() => session.redo()}>
              Повторить
            </button>
          </div>
          <span>
            {state.connected
              ? 'Изменения сохраняются автоматически'
              : 'Нет соединения. Ввод приостановлен.'}
          </span>
        </footer>
      </section>
    </div>
  );
}
