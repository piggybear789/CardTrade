// tests/component/savedAddressField.test.tsx
//
// The delivery-address field backed by the member's PRIVATE saved-address book
// (0113), shared by the cash-sale buy flow and the trade delivery step.
//
// What is worth pinning here is the sourcing behaviour, not the picker (that is
// covered where PlacePicker lives):
//
//   1. Saved addresses load and render as a chooser, so the requirement is surfaced
//      up front rather than as a late save error.
//   2. Choosing a saved address reports that place upward — this is the SOURCE the
//      contract copies from; the field never mutates the counterparty's data.
//   3. The default is prefilled when asked and nothing is selected yet, so the common
//      case is pre-answered.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listMyAddresses = vi.fn();
const saveAddress = vi.fn();

vi.mock('@/lib/actions/addresses', () => ({
  listMyAddresses: (...args: unknown[]) => listMyAddresses(...args),
  saveAddress: (...args: unknown[]) => saveAddress(...args),
}));

// The field renders a PlacePicker for the "different address" branch. Without a
// Google Maps key it renders a disabled/free-text fallback, which is all this test
// needs — it never types into it, it asserts on the saved-address chooser.
vi.mock('@/lib/location/googleMaps', () => ({
  readGoogleMapsKey: () => null,
}));

import { SavedAddressField } from '@/components/fulfilment/SavedAddressField';

const SAVED = [
  {
    id: 'a1',
    label: 'Home',
    addressLabel: '1 Home St, Fitzroy VIC 3065',
    placeId: 'ChIJhome',
    countryCode: 'AU',
    lat: -37.8,
    lng: 144.97,
    isDefault: true,
  },
  {
    id: 'a2',
    label: 'Work',
    addressLabel: '2 Work Rd, Carlton VIC 3053',
    placeId: 'ChIJwork',
    countryCode: 'AU',
    lat: -37.79,
    lng: 144.96,
    isDefault: false,
  },
];

beforeEach(() => {
  listMyAddresses.mockReset();
  saveAddress.mockReset();
  listMyAddresses.mockResolvedValue({ ok: true, data: SAVED });
});

describe('SavedAddressField', () => {
  it('lists the saved addresses as a chooser', async () => {
    const onChange = vi.fn();
    render(<SavedAddressField id="buy" value={null} onChange={onChange} />);

    expect(await screen.findByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText(/use a different address/i)).toBeInTheDocument();
  });

  it('prefills the default address when asked and nothing is selected', async () => {
    const onChange = vi.fn();
    render(
      <SavedAddressField id="buy" value={null} onChange={onChange} prefillDefault />,
    );

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    // The default (Home) is adopted, copied into a PlaceValue the contract can store.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ placeId: 'ChIJhome', label: '1 Home St, Fitzroy VIC 3065' }),
    );
  });

  it('does NOT prefill when a value is already chosen', async () => {
    const onChange = vi.fn();
    const chosen = {
      label: '2 Work Rd, Carlton VIC 3053',
      placeId: 'ChIJwork',
      lat: -37.79,
      lng: 144.96,
      countryCode: 'AU',
      precision: 'exact' as const,
    };
    render(
      <SavedAddressField id="buy" value={chosen} onChange={onChange} prefillDefault />,
    );

    await screen.findByText('Home');
    // A deliberate earlier choice is never overwritten by the default.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports the selected saved address upward as the source place', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SavedAddressField id="buy" value={null} onChange={onChange} />);

    await screen.findByText('Work');
    await user.click(screen.getByLabelText(/work/i, { selector: 'input' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ placeId: 'ChIJwork' }),
    );
  });

  it('surfaces the picker with no chooser when the book is empty', async () => {
    listMyAddresses.mockResolvedValue({ ok: true, data: [] });
    const onChange = vi.fn();
    render(<SavedAddressField id="buy" value={null} onChange={onChange} />);

    // No "different address" chooser when there is nothing to choose between; the
    // picker fallback carries the requirement instead.
    await waitFor(() => expect(listMyAddresses).toHaveBeenCalled());
    expect(screen.queryByText(/use a different address/i)).toBeNull();
  });
});
