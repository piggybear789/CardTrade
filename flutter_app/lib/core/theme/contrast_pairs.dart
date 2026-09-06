/// The role a declared foreground/background pair serves.
enum PairRole { text, controlEdge, focus, stateGraphic }

/// A foreground/background pair the agreement harness can measure.
class ContrastPair {
  const ContrastPair({required this.fg, required this.bg, this.level, required this.role});

  final String fg;
  final String bg;
  final String? level;
  final PairRole role;
}

/// Every text, control-edge, focus, and state-graphic pair the theme declares.
/// Requirements 13.1–13.5.
abstract final class AppContrastPairs {
  AppContrastPairs._();

  static const declaredPairs = <ContrastPair>[
    ContrastPair(fg: 'foreground', bg: 'background', level: 'body', role: PairRole.text),
    ContrastPair(fg: 'mutedForeground', bg: 'background', level: 'body', role: PairRole.text),
    ContrastPair(fg: 'mutedForeground', bg: 'muted', level: 'body', role: PairRole.text),
    ContrastPair(fg: 'mist', bg: 'obsidian', level: 'meta', role: PairRole.text),
    ContrastPair(fg: 'secondaryForeground', bg: 'secondary', level: 'body', role: PairRole.text),
    ContrastPair(fg: 'obsidian', bg: 'action', level: 'body', role: PairRole.text),
    ContrastPair(fg: 'primaryForeground', bg: 'primary', level: 'body', role: PairRole.text),
    ContrastPair(fg: 'destructiveForeground', bg: 'destructive', level: 'body', role: PairRole.text),
    ContrastPair(fg: 'accentForeground', bg: 'accent', level: 'body', role: PairRole.text),
    ContrastPair(fg: 'irisInk', bg: 'background', level: 'body', role: PairRole.text),
    ContrastPair(fg: 'input', bg: 'background', role: PairRole.controlEdge),
    ContrastPair(fg: 'actionBorder', bg: 'background', role: PairRole.controlEdge),
    ContrastPair(fg: 'iris', bg: 'background', role: PairRole.focus),
    ContrastPair(fg: 'trust', bg: 'background', role: PairRole.stateGraphic),
  ];

  static const exceptions = <ContrastPair>[];
}
