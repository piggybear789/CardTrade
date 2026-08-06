// tests/component/avatar.test.tsx
//
// The Avatar primitive, and specifically that it NEVER renders nothing.
//
// WHY THIS IS WORTH A TEST. Avatars arrived in 0066, so every account that existed
// before it has none and most members will never set one — the initials branch is
// the normal rendering, not a degraded one. Three ways it could regress into blank
// circles across the whole marketplace: losing the fallback, failing to fall back
// when a Storage object 404s, or being handed a name it cannot derive initials from.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { Avatar } from '@/components/ui/avatar';

const BASE = 'https://example.supabase.co';

describe('Avatar', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  });

  it('shows initials when there is no avatar', () => {
    render(<Avatar displayName="Ada Lovelace" avatarPath={null} />);
    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders the image when there is one, resolved from the path', () => {
    const { container } = render(
      <Avatar displayName="Ada Lovelace" avatarPath="owner-1/a.png" />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(
      `${BASE}/storage/v1/object/public/profile-images/owner-1/a.png`,
    );
    // The picture replaces the initials rather than sitting behind them.
    expect(screen.queryByText('AL')).not.toBeInTheDocument();
  });

  it('FALLS BACK to initials when the image fails to load', () => {
    // A cleared avatar, an expired object, or a Storage outage. Without this the
    // member gets a broken-image glyph on every surface they appear on.
    const { container } = render(
      <Avatar displayName="Ada Lovelace" avatarPath="owner-1/missing.png" />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();

    fireEvent.error(img as HTMLImageElement);

    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('still renders something for a name it cannot take initials from', () => {
    const { container } = render(<Avatar displayName="🙂" avatarPath={null} />);
    expect(container.textContent?.trim()).toBe('?');
  });

  it('is decorative by default, so a screen reader does not read the name twice', () => {
    // The name is essentially always rendered as text beside the avatar.
    const { container } = render(
      <Avatar displayName="Ada Lovelace" avatarPath="owner-1/a.png" />,
    );
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(container.querySelector('img')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes an accessible name when given one, for standalone use', () => {
    render(
      <Avatar
        displayName="Ada Lovelace"
        avatarPath="owner-1/a.png"
        alt="Your profile picture"
      />,
    );
    expect(screen.getByText('Your profile picture')).toBeInTheDocument();
  });

  it('does not leak a referrer for a member-supplied image', () => {
    // These render on pages showing money; a member's picture should not carry a
    // referrer to wherever it is hosted.
    const { container } = render(
      <Avatar displayName="Ada" avatarPath="owner-1/a.png" />,
    );
    expect(container.querySelector('img')?.getAttribute('referrerpolicy')).toBe(
      'no-referrer',
    );
  });
});
