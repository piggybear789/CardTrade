import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// Trivial sanity test for the jsdom (component) project. Confirms React
// Testing Library and jest-dom matchers are wired up under jsdom.
describe('test tooling sanity (component project)', () => {
  it('renders a component and finds it with a jest-dom matcher', () => {
    render(<h1>CardTrade</h1>);
    expect(screen.getByRole('heading', { name: 'CardTrade' })).toBeInTheDocument();
  });
});
