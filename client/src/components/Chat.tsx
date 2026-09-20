import { useEffect, useRef, useState } from 'react';
import { MAX_CHAT_LENGTH } from '@amath/shared';
import type { ChatMessage } from '@amath/shared';

interface Props {
  messages: ChatMessage[];
  you: 0 | 1;
  names: [string, string];
  onSend: (text: string) => void;
}

export function Chat({ messages, you, names, onSend }: Props) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const lastId = messages.length ? messages[messages.length - 1].id : 0;

  // follow new messages
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t.slice(0, MAX_CHAT_LENGTH));
    setText('');
  };

  return (
    <section className="chat" aria-label="Chat">
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 ? <p className="chat-empty">Say hello 👋</p> : null}
        {messages.map((m) => (
          <p key={m.id} className={m.player === you ? 'mine' : 'theirs'}>
            <b>{m.player === you ? 'You' : names[m.player]}</b> {m.text}
          </p>
        ))}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Message…"
          aria-label="Chat message"
          onChange={(e) => setText(e.target.value)}
        />
        <button disabled={!text.trim()}>Send</button>
      </form>
    </section>
  );
}
