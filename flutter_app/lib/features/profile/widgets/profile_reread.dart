// Re-reads the member's own profile from the server when the app is resumed, and
// reports how that re-read is going without ever dropping what the server last said.
//
// WHY A RESUME IS THE SIGNAL. Both verification steps finish on a Stripe-hosted page
// in the device browser. `launchUrl` returns as soon as the browser opens, so there
// is nothing to await and no result to read — the app is simply resumed later. A
// return marker in a URL would be no better than the resume and considerably worse
// than the read: `?identity=complete` says the member came back, not that the check
// passed, and the web app treats it exactly that way (`IdentityReturnRefresh`
// reconciles it against the server rather than trusting it). So this asks the server
// (Req 10.7).
//
// WHY THE LAST REPORTED PROFILE IS HELD HERE. `MyProfileNotifier.refresh` sets
// `AsyncLoading`, which empties the provider's value while the read is in flight. A
// screen watching only the provider would blank both marks and redraw them as
// pending — presenting a verified member as unverified every time they switched apps.
// The last value the SERVER reported is retained, and that is what the section keeps
// drawing until a newer one arrives (Req 10.7).
//
// NO NEW REQUEST CAPABILITY. It calls the same `refresh` the screen's own retry
// control already called; nothing here reads a table or an RPC of its own.
//
// Requirements 10.7, 10.8, 11.5, 14.12.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme.dart';
import '../../../models/profile.dart';
import '../../../providers/profile_provider.dart';
import '../../../widgets/common/controls.dart';

/// What the builder is handed on every rebuild.
@immutable
class ProfileReadState {
  const ProfileReadState({
    required this.read,
    required this.lastReported,
    required this.overdue,
    required this.retry,
  });

  /// The live read, for a first-load skeleton or a first-load failure.
  final AsyncValue<Profile?> read;

  /// The most recent profile the SERVER reported, retained across a re-read.
  final Profile? lastReported;

  /// Whether a re-read has been outstanding beyond [ProfileReRead.overdueAfter].
  final bool overdue;

  /// Asks the server again.
  final VoidCallback retry;

  /// Whether anything has ever been reported for this member.
  bool get hasReport => lastReported != null;
}

/// Builds its child from [ProfileReadState], re-reading on every app resume.
class ProfileReRead extends ConsumerStatefulWidget {
  const ProfileReRead({required this.builder, super.key});

  final Widget Function(BuildContext context, ProfileReadState state) builder;

  /// How long a re-read may be outstanding before the surface says so and offers
  /// to ask again. Req 10.7 fixes this at ten seconds.
  static const Duration overdueAfter = Duration(seconds: 10);

  @override
  ConsumerState<ProfileReRead> createState() => _ProfileReReadState();
}

class _ProfileReReadState extends ConsumerState<ProfileReRead> {
  Profile? _lastReported;
  Timer? _overdueTimer;
  bool _overdue = false;
  AppLifecycleListener? _lifecycle;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: _reRead);
  }

  @override
  void dispose() {
    _lifecycle?.dispose();
    _overdueTimer?.cancel();
    super.dispose();
  }

  void _reRead() {
    _overdueTimer?.cancel();
    _overdueTimer = Timer(ProfileReRead.overdueAfter, () {
      if (mounted) setState(() => _overdue = true);
    });
    // Fire and forget: the provider's own state is what the build below reads, so
    // awaiting here would only duplicate it.
    ref.read(myProfileProvider.notifier).refresh();
  }

  void _settle() {
    _overdueTimer?.cancel();
    _overdueTimer = null;
    if (_overdue && mounted) setState(() => _overdue = false);
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<Profile?> read = ref.watch(myProfileProvider);

    // Assigned during build rather than through setState: it caches what is
    // already on screen, so it must not schedule a second frame to record it.
    if (read.hasValue) _lastReported = read.value;
    if (!read.isLoading) {
      // A settled read — value or error — ends the wait. Deferred, because a
      // `setState` inside build is illegal and the timer may still be running.
      WidgetsBinding.instance.addPostFrameCallback((_) => _settle());
    }

    return widget.builder(
      context,
      ProfileReadState(
        read: read,
        lastReported: _lastReported,
        overdue: _overdue,
        retry: _reRead,
      ),
    );
  }
}

/// Says that a re-read is still outstanding and that what is on screen is the last
/// thing the server reported, and offers to ask again.
///
/// Neutral rather than alarming: nothing has failed and no status has changed, so it
/// is the `--muted` surface and not the alert wash. It carries a control rather than
/// only an apology, because a member who has just come back from a hosted flow wants
/// the answer and not an explanation of why it is late (Req 10.7, 11.4).
class ProfileReReadNotice extends StatelessWidget {
  const ProfileReReadNotice({required this.onReRead, super.key});

  /// Asks the server again.
  final VoidCallback onReRead;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.cozy),
      decoration: BoxDecoration(
        color: AppColors.muted,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border, width: AppMetrics.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Semantics(
            liveRegion: true,
            child: const Text(
              'Still checking your status. This is the last one we heard.',
              style: AppText.supportText,
              softWrap: true,
            ),
          ),
          const SizedBox(height: AppSpacing.snug),
          AppButton(
            label: 'Check again',
            icon: Icons.refresh_rounded,
            variant: AppButtonVariant.outline,
            onPressed: onReRead,
          ),
        ],
      ),
    );
  }
}
