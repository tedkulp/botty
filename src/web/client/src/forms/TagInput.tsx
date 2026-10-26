import { useState, type KeyboardEvent } from 'react';

interface TagInputProps {
  id: string;
  value: string[];
  onChange(next: string[]): void;
  describedBy?: string;
}

/** A string[] editor: chips with remove buttons; Enter or comma adds, Backspace on empty removes the last. */
export function TagInput({ id, value, onChange, describedBy }: TagInputProps) {
  const [text, setText] = useState('');

  function commit() {
    const tag = text.trim();
    setText('');
    if (tag && !value.includes(tag)) onChange([...value, tag]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="tag-input">
      {value.map((tag) => (
        <span key={tag} className="chip">
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        value={text}
        placeholder={value.length ? '' : 'Type and press Enter'}
        aria-describedby={describedBy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
    </div>
  );
}
