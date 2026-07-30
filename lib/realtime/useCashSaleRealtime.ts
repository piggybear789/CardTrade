'use client';

// lib/realtime/useCashSaleRealtime.ts
// Participant-only live Cash_Sale snapshot and audit events (Req 4.2, 4.18).

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { uniqueRealtimeTopic } from '@/lib/realtime/channelTopic';
import { createClient } from '@/lib/supabase/browser';
import type { Tables } from '@/lib/supabase/database.types';

export type CashSaleRow = Tables<'cash_sales'>;
export type CashSaleEventRow = Tables<'cash_sale_events'>;
export type CashSaleConnectionStatus =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'error';

const MAX_RECONNECTS = 10;
const retryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 30000);

/** Subscribe to one sale and its append-only event timeline. */
export function useCashSaleRealtime(cashSaleId: string) {
  const [sale, setSale] = useState<CashSaleRow | null>(null);
  const [events, setEvents] = useState<CashSaleEventRow[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<CashSaleConnectionStatus>('connecting');
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!clientRef.current) clientRef.current = createClient();

  const loadSnapshot = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const [saleResult, eventsResult] = await Promise.all([
      client.from('cash_sales').select('*').eq('id', cashSaleId).maybeSingle(),
      client
        .from('cash_sale_events')
        .select('*')
        .eq('cash_sale_id', cashSaleId)
        .order('created_at'),
    ]);
    if (saleResult.data) setSale(saleResult.data as CashSaleRow);
    if (eventsResult.data) setEvents(eventsResult.data as CashSaleEventRow[]);
  }, [cashSaleId]);
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !cashSaleId) return;
    let mounted = true;
    let channel: RealtimeChannel | null = null;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const reconnect = () => {
      if (!mounted) return;
      if (retries >= MAX_RECONNECTS) {
        setConnectionStatus('error');
        return;
      }
      setConnectionStatus('reconnecting');
      timer = setTimeout(subscribe, retryDelay(retries++));
    };

    const subscribe = () => {
      if (!mounted) return;
      if (channel) {
        void client.removeChannel(channel);
        channel = null;
      }
      const nextChannel = client
        .channel(uniqueRealtimeTopic(`cash-sale:${cashSaleId}`))
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'cardtrade',
            table: 'cash_sales',
            filter: `id=eq.${cashSaleId}`,
          },
          (payload) => {
            if (payload.eventType !== 'DELETE') {
              setSale(
                (payload as RealtimePostgresChangesPayload<CashSaleRow>)
                  .new as CashSaleRow,
              );
            }
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'cardtrade',
            table: 'cash_sale_events',
            filter: `cash_sale_id=eq.${cashSaleId}`,
          },
          (payload) => {
            const next = (
              payload as RealtimePostgresChangesPayload<CashSaleEventRow>
            ).new as CashSaleEventRow;
            setEvents((current) =>
              current.some((event) => event.id === next.id)
                ? current
                : [...current, next],
            );
          },
        );

      channel = nextChannel;
      nextChannel.subscribe((status) => {
        if (!mounted || channel !== nextChannel) return;
        if (status === 'SUBSCRIBED') {
          retries = 0;
          setConnectionStatus('live');
          void loadSnapshot();
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          channel = null;
          void client.removeChannel(nextChannel);
          reconnect();
        }
      });
    };

    setConnectionStatus('connecting');
    void loadSnapshot();
    subscribe();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
      if (channel) void client.removeChannel(channel);
    };
  }, [cashSaleId, loadSnapshot]);

  return { sale, events, connectionStatus };
}
