// Account-level actions that are not profile edits.
//
// One method today: closing the member's own account. It is a POST to
// `app/api/mobile/account/close`, which authenticates the bearer token and delegates
// to `closeAccount` in `domain/orchestrator/accountClosureOrchestrator.ts` — the same
// Account_Closure_Service the web app calls (Req 7.1). Nothing about the money rule,
// the own-account guard or the anonymise-and-detach sequence is repeated here: this is
// one HTTP call over the shared client, with no `.rpc()` call site and no table write
// (Req 7.10).
//
// Requirements 7.1, 7.8, 7.10.

import '../core/api_routes.dart';
import '../core/result.dart';
import 'mobile_api_client.dart';

/// What a successful closure reports back.
class AccountClosure {
  const AccountClosure({required this.closedAt});

  /// The instant the server recorded the closure at, as it reported it.
  final String closedAt;
}

/// Account-level actions for the signed-in member.
class AccountService {
  AccountService(this._api);

  final MobileApiClient _api;

  /// Close the signed-in member's own account.
  ///
  /// The target is never sent: the endpoint takes it from the session, which is the
  /// whole of the own-account guard (Req 7.7). A refusal comes back as an [Err] whose
  /// `details['blockers']` names the categories of unsettled value that block it
  /// (Req 7.3), for the caller to render.
  Future<Result<AccountClosure>> closeAccount() {
    return _api.post<AccountClosure>(
      ApiRoutes.accountClose,
      transform: (dynamic data) {
        final map = data is Map<String, dynamic> ? data : const <String, dynamic>{};
        return AccountClosure(closedAt: map['closedAt'] as String? ?? '');
      },
    );
  }
}
