import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import '../../core/theme.dart';
import 'controls.dart';

/// A failed request, described to the member who was waiting for it.
///
/// [operation] is a noun phrase naming what failed in the member's own terms —
/// "your trades", "the catalog" — so the explanation says which request to try
/// again rather than that something, somewhere, went wrong (Req 11.4).
///
/// This is beside [ErrorView.sanitise] deliberately: both answer the one question
/// of what a member is told when a request fails, and separating them is how a
/// screen ends up describing a lost connection as a server fault.
@immutable
class RequestFailure {
  const RequestFailure({required this.operation, required this.offline});

  /// Classifies [error] without ever quoting it.
  ///
  /// The error's own text is read only to decide whether the DEVICE lost its
  /// connection; none of it is shown. A lost connection is a different message
  /// from a fault (Req 11.10): nothing on the server has gone wrong, and
  /// retrying once the device is back on line will work.
  factory RequestFailure.from(Object error, {required String operation}) {
    return RequestFailure(
      operation: operation,
      offline: isConnectivityFailure(error),
    );
  }

  /// The member-facing name of the request that failed.
  final String operation;

  /// Whether the cause was the device having no connectivity.
  final bool offline;

  /// Text a transport failure puts in an error value, in either the Dart socket
  /// layer or the HTTP client the Supabase package uses.
  ///
  /// Matched against the type name AND the message, because the two layers report
  /// the same condition differently: `SocketException` names itself, while the
  /// HTTP client wraps a failed host lookup in a generic client exception whose
  /// message is the only signal.
  static final List<RegExp> _connectivityMarkers = [
    RegExp(r'\bSocketException\b'),
    RegExp(r'\bClientException\b'),
    RegExp(r'\bHandshakeException\b'),
    RegExp(r'\bTimeoutException\b'),
    RegExp(r'\bAuthRetryableFetchException\b'),
    RegExp(r'failed host lookup', caseSensitive: false),
    RegExp(r'network is (?:unreachable|down)', caseSensitive: false),
    RegExp(r'no route to host', caseSensitive: false),
    RegExp(r'connection (?:refused|closed|reset|failed|timed out)',
        caseSensitive: false),
    RegExp(r'software caused connection abort', caseSensitive: false),
    RegExp(r'\btimed out\b', caseSensitive: false),
  ];

  /// Whether [error] reports the device being unable to reach the network.
  static bool isConnectivityFailure(Object error) {
    final String text = '${error.runtimeType} $error';
    return _connectivityMarkers.any((marker) => marker.hasMatch(text));
  }

  /// The heading. Short, and says which of the two kinds of failure this is.
  String get title => offline ? 'You\'re offline' : 'We couldn\'t load that';

  /// The explanation. Names the operation, and the connection where that was the
  /// cause, and never the provider, the record or the exception.
  String get message => offline
      ? 'Your device isn\'t connected, so we couldn\'t load $operation. '
          'Anything already loaded is still here.'
      : 'We couldn\'t load $operation. Nothing has changed — try again.';

  /// The glyph. A second, motionless signal for the distinction the copy draws,
  /// so the two failures stay apart in greyscale (Req 13.11).
  IconData get icon =>
      offline ? Icons.wifi_off_rounded : Icons.error_outline_rounded;

  /// What a member is told when a REFRESH of content already on screen failed.
  ///
  /// Deliberately not [message]: the content behind that notice is still theirs
  /// and still valid, and telling them it could not be loaded would contradict
  /// what they are looking at (Req 11.5).
  String get refreshMessage => offline
      ? 'Your device isn\'t connected, so this is what we last heard about '
          '$operation.'
      : 'We couldn\'t refresh $operation. This is what we last heard.';
}

/// A failed request, explained in member-facing terms with a way to retry.
///
/// The explanation is SANITISED before it is drawn (Req 11.4). Every caller in
/// the client passes `error.toString()`, which is how a `PostgrestException`, a
/// provider identifier or a stack frame reaches a member's screen — and on a
/// marketplace that holds money, a leaked `pi_…` or a table name is a disclosure,
/// not a rough edge. [sanitise] is the one place that is filtered, so a call site
/// cannot forget.
///
/// It also ANNOUNCES itself, assertively, when it appears. A settled failure is
/// the arrival of an answer a member is waiting for, so it interrupts an
/// announcement already in progress — the opposite of the skeleton's polite one
/// (Req 11.4).
///
/// Requirements 11.4, 1.7–1.8, 2.13, 3.4.
class ErrorView extends StatefulWidget {
  const ErrorView({
    this.title = 'Something went wrong',
    this.message = 'We couldn\'t load this content. Please try again.',
    this.onRetry,
    this.icon = Icons.error_outline_rounded,
    super.key,
  });

  /// The error state for a classified [RequestFailure].
  ///
  /// Prefer this over passing `error.toString()`: the message names the operation
  /// that failed and distinguishes a lost connection from a fault, where a
  /// sanitised error value can only ever produce the generic sentence.
  ErrorView.forFailure(RequestFailure failure, {this.onRetry, super.key})
      : title = failure.title,
        message = failure.message,
        icon = failure.icon;

  /// Heading text (keep short and member-facing).
  final String title;

  /// Explanation of what failed, in member-facing terms.
  final String message;

  /// Called when the retry control is activated. No control is drawn when null.
  final VoidCallback? onRetry;

  /// The glyph displayed above the heading. Decorative.
  final IconData icon;

  /// What a member is told when the caller's text cannot be shown to them.
  static const String genericExplanation =
      'We couldn\'t load this content. Please try again.';

  /// Patterns that mark text as internal rather than member-facing.
  static final List<RegExp> _internalMarkers = [
    // Dart and Postgres exception preambles: `Exception: …`, `PostgrestException(…`.
    RegExp(r'\b\w*(?:Exception|Error)\b\s*[:(]'),
    // A stack frame, in either Dart or JS shape.
    RegExp(r'(^|\s)#\d+\s|\bat\s+\w+\s*\('),
    // Payment-provider record identifiers.
    // `cus_` is here because Property 21 names it: a customer reference is the
    // one of these a member could plausibly be shown by mistake, since it is the
    // record that stands for them.
    // The tail admits underscores. Without them `sk_test_AbCdEfGh` slipped
    // through: the segment after `sk_` was the four characters `test`, short of
    // the six the pattern demanded, and the key itself was then shown to a member.
    RegExp(r'\b(?:pi|seti|acct|cus|cs|py|tr|ch|vs|vf|sk|whsec|pk)_[A-Za-z0-9_]{6,}'),
    // Provider names, which a member has no relationship with.
    RegExp(r'\b(?:stripe|supabase|postgrest|ship24)\b', caseSensitive: false),
    // A bare record identifier: a UUID.
    RegExp(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b',
        caseSensitive: false),
  ];

  /// Returns [text] when it is safe to show a member, and [genericExplanation]
  /// otherwise. Never returns an empty string: a blank explanation reads as the
  /// client having broken rather than the request having failed.
  static String sanitise(String text) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return genericExplanation;
    for (final marker in _internalMarkers) {
      if (marker.hasMatch(trimmed)) return genericExplanation;
    }
    return trimmed;
  }

  @override
  State<ErrorView> createState() => _ErrorViewState();
}

class _ErrorViewState extends State<ErrorView> {
  bool _announced = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Once per appearance, and here rather than in `initState`, where reading
    // `Directionality` is not yet legal.
    if (_announced) return;
    _announced = true;
    final view = View.maybeOf(context);
    if (view == null) return;
    SemanticsService.sendAnnouncement(
      view,
      '${widget.title}. ${ErrorView.sanitise(widget.message)}',
      Directionality.maybeOf(context) ?? TextDirection.ltr,
      assertiveness: Assertiveness.assertive,
    );
  }

  @override
  Widget build(BuildContext context) {
    final String title = widget.title;
    final String message = widget.message;
    final IconData icon = widget.icon;
    final VoidCallback? onRetry = widget.onRetry;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.group),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ExcludeSemantics(
              child: Icon(
                icon,
                size: AppIconSize.display,
                color: AppColors.destructive,
              ),
            ),
            const SizedBox(height: AppSpacing.snug),
            Text(
              title,
              style: AppType.subhead.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.foreground,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.tight),
            Text(
              ErrorView.sanitise(message),
              style: AppText.supportText,
              textAlign: TextAlign.center,
            ),
            if (onRetry != null) ...[
              const SizedBox(height: AppSpacing.snug),
              // Drawn at 40, touched at 48 — the separation lives in AppButton.
              AppButton(
                label: 'Try again',
                icon: Icons.refresh_rounded,
                variant: AppButtonVariant.outline,
                onPressed: onRetry,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
