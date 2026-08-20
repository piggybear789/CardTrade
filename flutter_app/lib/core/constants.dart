/// App-wide constants for CardTrade.
///
/// Matches the web app's marketplace-constants.ts values.
abstract final class AppConstants {
  // ─── Platform Fees ─────────────────────────────────────────────────────────
  /// Platform fee in basis points (5%).
  static const int platformFeeBps = 500;

  // ─── Inspection Windows ────────────────────────────────────────────────────
  /// Cash sale inspection window in days.
  static const int cashSaleInspectionDays = 7;

  /// Trade inspection window in hours.
  static const int tradeInspectionHours = 72;

  /// Minimum inspection floor for trades (hours).
  static const int tradeInspectionFloorHours = 24;

  // ─── Validation Limits ─────────────────────────────────────────────────────
  /// Maximum title length for listings.
  static const int titleMaxLength = 120;

  /// Maximum description length for listings.
  static const int descriptionMaxLength = 2000;

  /// Minimum images per listing.
  static const int imagesMin = 1;

  /// Maximum images per listing.
  static const int imagesMax = 10;

  /// Maximum FMV in cents (prevents accidental astronomical values).
  static const int fmvMaxCents = 99999999999;

  // ─── Message Limits ─────────────────────────────────────────────────────────
  /// Minimum message body length.
  static const int messageBodyMin = 1;

  /// Maximum message body length.
  static const int messageBodyMax = 4000;

  // ─── Offer Limits ──────────────────────────────────────────────────────────
  /// Minimum offer amount in cents.
  static const int offerAmountMinCents = 1;

  /// Maximum offer amount in cents.
  static const int offerAmountMaxCents = 99999999999;

  // ─── Dispute Limits ────────────────────────────────────────────────────────
  /// Minimum dispute reason length.
  static const int disputeReasonMin = 10;

  /// Maximum dispute reason length.
  static const int disputeReasonMax = 2000;

  // ─── Report Limits ─────────────────────────────────────────────────────────
  /// Minimum report reason length.
  static const int reportReasonMin = 1;

  /// Maximum report reason length.
  static const int reportReasonMax = 100;

  /// Maximum report details length.
  static const int reportDetailsMax = 1000;

  // ─── Trade Proposal Limits ─────────────────────────────────────────────────
  /// Maximum trade proposal message length.
  static const int tradeProposalMessageMax = 2000;

  // ─── Supabase Schema ───────────────────────────────────────────────────────
  /// The Postgres schema used for all CardTrade tables.
  static const String dbSchema = 'cardtrade';

  // ─── Storage Buckets ───────────────────────────────────────────────────────
  static const String itemImagesBucket = 'item-images';
  static const String avatarsBucket = 'profile-images';

  // ─── Pagination ────────────────────────────────────────────────────────────
  /// Default page size for list queries.
  static const int defaultPageSize = 20;

  // ─── Games ─────────────────────────────────────────────────────────────────
  /// Card games a listing can be tagged with. Must match `CARD_GAMES` on web.
  static const List<String> games = [
    'Pokémon',
    'Magic: The Gathering',
    'One Piece',
    'Yu-Gi-Oh!',
    'Disney Lorcana',
    'Riftbound',
    'Gundam',
    'Dragon Ball Super',
    'Digimon',
    'Star Wars: Unlimited',
    'Flesh and Blood',
    'Union Arena',
    'Weiss Schwarz',
    'Cardfight!! Vanguard',
    'Sports Cards',
    'Other TCG',
  ];

  // ─── Conditions ────────────────────────────────────────────────────────────
  static const List<String> conditions = [
    'Mint',
    'Near Mint',
    'Good',
    'Fair',
    'Poor',
  ];
}
