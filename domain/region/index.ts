// domain/region/index.ts
// Public surface of the region model.

export {
  REGIONS,
  FALLBACK_REGION,
  normalizeRegionCode,
  findRegion,
  regionLabel,
  regionCurrency,
  regionLocale,
  isTradingRegion,
  tradingRegions,
  platformRegion,
  settlementCurrency,
  needsCurrencyConversion,
  minorUnitDigits,
  assertMinorUnitSupported,
  minorToMajor,
  checkRegionCompatibility,
  regionMismatchMessage,
  type RegionCode,
  type RegionDefinition,
  type RegionMismatch,
  type RegionSource,
} from './regions';
