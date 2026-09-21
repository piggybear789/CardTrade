'use client';

// lib/images/usePreviewFiles.ts
//
// Files a member has picked but not yet uploaded, each with ONE preview URL that lives
// exactly as long as the file is in the list.
//
// WHY THIS EXISTS. `URL.createObjectURL(file)` is cheap to call and expensive to
// consume: every distinct URL is a distinct resource, so an `<img>` whose `src` is a
// fresh object URL fetches and DECODES the file again. The listing form and the
// dispute dialog both called it inline in render — `src={URL.createObjectURL(file)}` —
// which meant every keystroke in the description box minted a new URL for every
// thumbnail and the cover, and the browser decoded every phone photo on the page again.
// That was the lag typing into those forms: not React, not the textarea, but a dozen
// multi-megabyte JPEG decodes per character. The URLs were never revoked either, so the
// tab's memory grew with every render.
//
// THE RULE: create the URL when the file ARRIVES, in the event handler, and revoke it
// when the file leaves or the component does. Never in render — a render can run any
// number of times and must not allocate — and never in a state updater, which React is
// entitled to call twice. `key` is a per-hook counter rather than the file name, so two
// picks of the same file are two entries and removing one never removes the other.

import { useCallback, useEffect, useRef, useState } from 'react';

/** A picked file and the one preview URL it owns. */
export interface PreviewFile {
  /** Stable React key. Not the file name: the same name can be picked twice. */
  key: string;
  file: File;
  /** An object URL for `file`. Valid until the entry is removed or the hook unmounts. */
  url: string;
}

export interface PreviewFiles {
  items: PreviewFile[];
  /** The bare files, for the upload call. */
  files: File[];
  /**
   * Append picked files. Anything past `max` is dropped rather than failing the
   * whole pick, so choosing twelve when ten fit keeps the first ten.
   */
  add: (picked: File[]) => void;
  /** Remove one entry and revoke its URL. */
  remove: (key: string) => void;
  /** Remove every entry and revoke every URL — a form resetting after submit. */
  clear: () => void;
}

/**
 * Own a list of picked files and their preview URLs.
 *
 * @param max optional cap on how many entries the list may hold
 */
export function usePreviewFiles(max?: number): PreviewFiles {
  const [items, setItems] = useState<PreviewFile[]>([]);
  const nextKey = useRef(0);

  // The latest list, for the unmount cleanup below. Reading `items` there directly
  // would close over the first render's empty list and revoke nothing.
  const latest = useRef(items);
  latest.current = items;

  const add = useCallback(
    (picked: File[]) => {
      if (picked.length === 0) return;
      // Sized against the list as it is NOW, outside the updater, so the URLs are
      // created exactly once per accepted file however many times React replays the
      // update. Two picks landing between renders is not a real interaction.
      const room = max === undefined ? picked.length : Math.max(0, max - latest.current.length);
      const created = picked.slice(0, room).map((file) => ({
        key: `preview-${nextKey.current++}`,
        file,
        url: URL.createObjectURL(file),
      }));
      if (created.length === 0) return;
      setItems((prev) => [...prev, ...created]);
    },
    [max],
  );

  const remove = useCallback((key: string) => {
    const gone = latest.current.find((item) => item.key === key);
    if (gone) URL.revokeObjectURL(gone.url);
    setItems((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const clear = useCallback(() => {
    for (const item of latest.current) URL.revokeObjectURL(item.url);
    setItems([]);
  }, []);

  // Everything still held when the component goes away is released. Object URLs are
  // per-document and outlive the component otherwise.
  useEffect(() => {
    return () => {
      for (const item of latest.current) URL.revokeObjectURL(item.url);
    };
  }, []);

  return {
    items,
    files: items.map((item) => item.file),
    add,
    remove,
    clear,
  };
}
