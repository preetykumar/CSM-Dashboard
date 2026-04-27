import { useState, useEffect, useRef } from "react";

interface TodoItem {
  id: string;
  text: string;
  notes: string;
  completed: boolean;
  createdAt: string;
}

const STORAGE_KEY = "portal_personal_todos";

function loadTodos(): TodoItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveTodos(todos: TodoItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
}

export function PersonalTodoWidget() {
  const [todos, setTodos] = useState<TodoItem[]>(loadTodos);
  const [newText, setNewText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveTodos(todos);
  }, [todos]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
    }
  }, [editingId]);

  const addTodo = () => {
    const text = newText.trim();
    if (!text) return;
    setTodos((prev) => [
      ...prev,
      { id: `todo-${Date.now()}`, text, notes: "", completed: false, createdAt: new Date().toISOString() },
    ]);
    setNewText("");
    inputRef.current?.focus();
  };

  const toggleTodo = (id: string) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

  const deleteTodo = (id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  const startEdit = (todo: TodoItem) => {
    setEditingId(todo.id);
    setEditText(todo.text);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const text = editText.trim();
    if (text) {
      setTodos((prev) =>
        prev.map((t) => (t.id === editingId ? { ...t, text } : t))
      );
    }
    setEditingId(null);
    setEditText("");
  };

  const updateNotes = (id: string, notes: string) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, notes } : t))
    );
  };

  const clearCompleted = () => {
    setTodos((prev) => prev.filter((t) => !t.completed));
  };

  const activeTodos = todos.filter((t) => !t.completed);
  const completedTodos = todos.filter((t) => t.completed);

  return (
    <section className="home-widget personal-todo-widget" aria-labelledby="personal-todo-title">
      <div className="widget-header">
        <h3 id="personal-todo-title">My To-Do List</h3>
        {completedTodos.length > 0 && (
          <button className="todo-clear-btn" onClick={clearCompleted}>
            Clear completed ({completedTodos.length})
          </button>
        )}
      </div>

      <div className="todo-add-form">
        <input
          ref={inputRef}
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addTodo(); }}
          placeholder="Add a task..."
          className="todo-add-input"
          aria-label="Add a task"
        />
        <button className="todo-add-btn" onClick={addTodo} disabled={!newText.trim()}>
          Add
        </button>
      </div>

      {todos.length === 0 ? (
        <p className="todo-empty">No tasks yet. Add one above.</p>
      ) : (
        <ul className="todo-list" role="list">
          {activeTodos.map((todo) => (
            <li key={todo.id} className={`todo-item ${expandedId === todo.id ? "expanded" : ""}`}>
              <div className="todo-item-row">
                <label className="todo-checkbox-label">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => toggleTodo(todo.id)}
                    aria-label={`Mark "${todo.text}" as complete`}
                  />
                  <span className="todo-checkmark" />
                </label>
                {editingId === todo.id ? (
                  <input
                    ref={editRef}
                    type="text"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                    onBlur={saveEdit}
                    className="todo-edit-input"
                  />
                ) : (
                  <span className="todo-text" onDoubleClick={() => startEdit(todo)}>{todo.text}</span>
                )}
                <button className="todo-notes-toggle" onClick={() => setExpandedId(expandedId === todo.id ? null : todo.id)} aria-label="Toggle notes" title={todo.notes ? "View notes" : "Add notes"}>
                  {todo.notes ? "\u270E" : "+"}
                </button>
                <button className="todo-delete-btn" onClick={() => deleteTodo(todo.id)} aria-label={`Delete "${todo.text}"`}>
                  &times;
                </button>
              </div>
              {expandedId === todo.id && (
                <textarea
                  className="todo-notes-input"
                  value={todo.notes}
                  onChange={(e) => updateNotes(todo.id, e.target.value)}
                  placeholder="Add notes..."
                  rows={2}
                />
              )}
            </li>
          ))}
          {completedTodos.map((todo) => (
            <li key={todo.id} className="todo-item completed">
              <label className="todo-checkbox-label">
                <input
                  type="checkbox"
                  checked={true}
                  onChange={() => toggleTodo(todo.id)}
                  aria-label={`Mark "${todo.text}" as incomplete`}
                />
                <span className="todo-checkmark" />
              </label>
              <span className="todo-text completed-text">{todo.text}</span>
              <button className="todo-delete-btn" onClick={() => deleteTodo(todo.id)} aria-label={`Delete "${todo.text}"`}>
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      {todos.length > 0 && (
        <div className="todo-footer">
          {activeTodos.length} remaining{completedTodos.length > 0 && `, ${completedTodos.length} completed`}
        </div>
      )}
    </section>
  );
}
