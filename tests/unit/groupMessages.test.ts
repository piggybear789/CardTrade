import { describe, expect, it } from 'vitest';

import { groupMessages, type ChatMessage } from '@/components/messages/groupMessages';

function message(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'created_at' | 'body'>): ChatMessage {
  return {
    conversation_id: 'c1',
    sender_id: 'buyer',
    kind: 'USER',
    system_event: null,
    read_at: null,
    attachment_path: null,
    attachment_name: null,
    attachment_mime: null,
    attachment_bytes: null,
    ...partial,
  };
}

describe('groupMessages', () => {
  it('clusters consecutive messages from the same sender within five minutes', () => {
    const clusters = groupMessages(
      [
        message({ id: '1', sender_id: 'buyer', body: 'hey', created_at: '2026-08-18T09:00:00.000Z' }),
        message({ id: '2', sender_id: 'buyer', body: 'you there', created_at: '2026-08-18T09:01:00.000Z' }),
        message({ id: '3', sender_id: 'seller', body: 'yes', created_at: '2026-08-18T09:01:30.000Z' }),
      ],
      'buyer',
    );

    const users = clusters.filter((cluster) => cluster.type === 'user');
    expect(users).toHaveLength(2);
    expect(users[0].messages.map((row) => row.id)).toEqual(['1', '2']);
    expect(users[0].mine).toBe(true);
    expect(users[1].messages.map((row) => row.id)).toEqual(['3']);
    expect(users[1].mine).toBe(false);
  });

  it('breaks a cluster after five minutes or a system line', () => {
    const clusters = groupMessages(
      [
        message({ id: '1', sender_id: 'buyer', body: 'first', created_at: '2026-08-18T09:00:00.000Z' }),
        message({
          id: 'sys',
          sender_id: null,
          kind: 'SYSTEM',
          body: 'Terms updated.',
          created_at: '2026-08-18T09:00:30.000Z',
        }),
        message({ id: '2', sender_id: 'buyer', body: 'later', created_at: '2026-08-18T09:10:00.000Z' }),
      ],
      'buyer',
    );

    const users = clusters.filter((cluster) => cluster.type === 'user');
    expect(users).toHaveLength(2);
    expect(users[0].messages).toHaveLength(1);
    expect(users[1].messages).toHaveLength(1);
    expect(clusters.some((cluster) => cluster.type === 'system')).toBe(true);
  });
});
