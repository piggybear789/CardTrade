/// Region Compatibility — contract guards for trading regions.
///
/// Mirrors `domain/region/regions.ts` in the web app.
///
/// The marketplace is regional: one deployment, listings scoped to a
/// jurisdiction, contracts completed inside one. Browsing crosses regions;
/// contracts do not.
///
/// TWO region values — merging them is the mistake to avoid:
/// - `items.location_country_code` is where the GOODS are (scopes catalog)
/// - `profiles.region_code` is where the MEMBER trades (gates contracts)
library;
import '../../models/region.dart';
import '../generated/regions.g.dart';

/// All known regions, aliased to the GENERATED registry.
///
/// This list used to be hand-written here, which made it a SECOND copy of the
/// region table inside the same Dart package - and it drifted. `US` was opened for
/// trading in `domain/region/regions.ts` and in `generated/regions.g.dart`, but the
/// copy here still lacked the flag, so `isTradingRegion` below answered false and
/// the app refused every US contract while the generated file said otherwise.
///
/// Re-generate the source of truth with:
///   npx tsx scripts/generate-dart-vocabulary.ts
const List<Region> allRegions = generatedRegions;

/// The reason a region check failed.
enum RegionMismatchReason {
  /// One or both regions are null or unknown.
  unknownRegion,

  /// Buyer and seller are in different regions.
  crossRegion,

  /// Both are in the same region but it's not enabled for trading.
  regionNotEnabled,
}

/// A region compatibility failure.
class RegionMismatch {
  const RegionMismatch({
    required this.reason,
    this.buyerRegion,
    this.sellerRegion,
  });

  final RegionMismatchReason reason;
  final String? buyerRegion;
  final String? sellerRegion;

  /// Member-facing explanation of why the contract can't proceed.
  String get message {
    switch (reason) {
      case RegionMismatchReason.unknownRegion:
        return 'Both parties must have a trading region set to start a contract.';
      case RegionMismatchReason.crossRegion:
        return 'You and this seller are in different regions. Contracts can only be completed within the same region.';
      case RegionMismatchReason.regionNotEnabled:
        return 'Trading is not yet available in this region.';
    }
  }
}

/// Normalizes a region code: trims, uppercases, validates 2-letter alpha.
/// Returns null for invalid/unknown codes.
String? normalizeRegionCode(String? value) {
  if (value == null) return null;
  final trimmed = value.trim().toUpperCase();
  if (trimmed.length != 2) return null;
  if (!RegExp(r'^[A-Z]{2}$').hasMatch(trimmed)) return null;
  // Must be a known region
  final known = allRegions.any((r) => r.code == trimmed);
  return known ? trimmed : null;
}

/// Finds a region definition by code.
Region? findRegion(String? code) {
  if (code == null) return null;
  final normalized = normalizeRegionCode(code);
  if (normalized == null) return null;
  try {
    return allRegions.firstWhere((r) => r.code == normalized);
  } catch (_) {
    return null;
  }
}

/// Member-facing label for a region code.
String regionLabel(String? code) {
  return findRegion(code)?.label ?? code ?? 'Unknown';
}

/// Whether a region code is enabled for trading.
bool isTradingRegion(String? code) {
  final region = findRegion(code);
  return region?.tradingEnabled ?? false;
}

/// All regions where trading is enabled.
List<Region> tradingRegions() {
  return allRegions.where((r) => r.tradingEnabled).toList();
}

/// Checks region compatibility between buyer and seller.
///
/// Returns null if compatible (contract may proceed).
/// Returns a [RegionMismatch] describing why the contract is blocked.
///
/// This is a contract guard, NOT a browse filter:
/// - A shared link, watchlist entry, or direct URL all bypass the catalog
/// - Evaluate compatibility only through this function
/// - An ABSENT region is refused, not waved through
RegionMismatch? checkRegionCompatibility(
  String? buyerRegion,
  String? sellerRegion,
) {
  final normalizedBuyer = normalizeRegionCode(buyerRegion);
  final normalizedSeller = normalizeRegionCode(sellerRegion);

  // Both must be known
  if (normalizedBuyer == null || normalizedSeller == null) {
    return RegionMismatch(
      reason: RegionMismatchReason.unknownRegion,
      buyerRegion: normalizedBuyer,
      sellerRegion: normalizedSeller,
    );
  }

  // Must be the same region
  if (normalizedBuyer != normalizedSeller) {
    return RegionMismatch(
      reason: RegionMismatchReason.crossRegion,
      buyerRegion: normalizedBuyer,
      sellerRegion: normalizedSeller,
    );
  }

  // Must be a trading-enabled region
  if (!isTradingRegion(normalizedBuyer)) {
    return RegionMismatch(
      reason: RegionMismatchReason.regionNotEnabled,
      buyerRegion: normalizedBuyer,
      sellerRegion: normalizedSeller,
    );
  }

  return null; // Compatible
}
