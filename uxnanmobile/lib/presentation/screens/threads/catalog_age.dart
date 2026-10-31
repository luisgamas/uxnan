/// How long ago, in the catalog's three groups.
enum CatalogAge {
  /// Since midnight.
  today,

  /// The last seven days.
  week,

  /// Before that, or unknown.
  earlier;

  /// The group [at] falls in, seen from [now].
  static CatalogAge of(DateTime? at, DateTime now) {
    if (at == null) return CatalogAge.earlier;
    final midnight = DateTime(now.year, now.month, now.day);
    if (!at.isBefore(midnight)) return CatalogAge.today;
    if (now.difference(at) <= const Duration(days: 7)) return CatalogAge.week;
    return CatalogAge.earlier;
  }
}
