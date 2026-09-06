// A synthetic theme file carrying one ratchet marker.
//
// The live theme layer holds none any more: task 12.1 deleted the last alias, and
// Req 1.11 forbids leaving a zero-reference one behind. So the vacuous-pass canary
// (P12) proves the marker reader still reads by pointing it at this file instead of
// asserting the live set is non-empty, which would now be asserting the migration
// is unfinished.
abstract final class MigrationAliasesFixture {
  MigrationAliasesFixture._();

  // MOBILE_THEME_ALIAS: fixtureAlias -> card; starting refs: 3.
  static const int fixtureAlias = 0;
}
