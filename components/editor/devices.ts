// components/editor/devices.ts
//
// Used by the deal composer (`/deals`); the listing editor's preview has no device.
//
// The preview devices' real sizes, in CSS pixels, as plain constants outside the
// client module (`DevicePreview`) so a server component can read them as values.

/**
 * The devices are drawn at their REAL size in CSS pixels and scaled as one piece to
 * fit the pane, so the page inside lays out and wraps exactly as it will on that
 * device, and the device keeps its true proportions at any pane size.
 *
 * iPhone 15 / 16: a 393 x 852 point screen with 55pt corners, inside an 11pt bezel.
 */
export const PHONE = { screenWidth: 393, screenHeight: 852, bezel: 11, width: 415, height: 874 };
/** A laptop browser window: 1024 wide, a little under a 16:10 screen. */
export const BROWSER = { width: 1024, height: 680 };
