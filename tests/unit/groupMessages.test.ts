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

  it('gathers a run of contract events into one system cluster', () => {
    const clusters = groupMessages(
      [
        message({
          id: 'e1',
          sender_id: null,
          kind: 'SYSTEM',
          system_event: 'PAYMENT_CLEARED',
          body: 'Payment confirmed.',
          created_at: '2026-08-18T09:00:00.000Z',
        }),
        message({
          id: 'e2',
          sender_id: null,
          kind: 'SYSTEM',
          system_event: 'SHIPMENT_RECORDED',
          body: 'Marked as shipped.',
          created_at: '2026-08-18T09:05:00.000Z',
        }),
      ],
      'buyer',
    );

    const systems = clusters.filter((cluster) => cluster.type === 'system');
    expect(systems).toHaveLength(1);
    expect(systems[0].messages.map((row) => row.id)).toEqual(['e1', 'e2']);
  });

  // REVERSED DELIBERATELY. This used to assert a new cluster per calendar day,
  // which split a sale that paid on Thursday and completed on Sunday into four
  // records with a date label wedged between each. A contract is one continuous
  // thing; its rows carry their own absolute date instead.
  it('keeps one contract run when it spans days, and marks no day for it', () => {
    const clusters = groupMessages(
      [
        message({
          id: 'e1',
          sender_id: null,
          kind: 'SYSTEM',
          body: 'Payment confirmed.',
          created_at: '2026-08-18T09:00:00.000Z',
        }),
        message({
          id: 'e2',
          sender_id: null,
          kind: 'SYSTEM',
          body: 'Marked as shipped.',
          created_at: '2026-08-19T09:00:00.000Z',
        }),
      ],
      'buyer',
    );

    const systems = clusters.filter((cluster) => cluster.type === 'system');
    expect(systems).toHaveLength(1);
    expect(systems[0].messages.map((row) => row.id)).toEqual(['e1', 'e2']);
    expect(clusters.some((cluster) => cluster.type === 'day')).toBe(false);
  });

  it('still marks the day for human messages either side of a contract run', () => {
    const clusters = groupMessages(
      [
        message({ id: 'u1', sender_id: 'buyer', body: 'sent', created_at: '2026-08-18T09:00:00.000Z' }),
        message({
          id: 'e1',
          sender_id: null,
          kind: 'SYSTEM',
          body: 'Payment confirmed.',
          created_at: '2026-08-18T09:05:00.000Z',
        }),
        message({ id: 'u2', sender_id: 'buyer', body: 'thanks', created_at: '2026-08-20T09:00:00.000Z' }),
      ],
      'buyer',
    );

    const days = clusters.filter((cluster) => cluster.type === 'day');
    expect(days).toHaveLength(2);
    // The run sits between them rather than starting the second day itself.
    expect(clusters.map((cluster) => cluster.type)).toEqual([
      'day',
      'user',
      'system',
      'day',
      'user',
    ]);
  });
});
