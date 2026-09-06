// The golden suite's network-image stub: the reason a captured photo is a
// PLACEHOLDER and not a race.
//
// SEVERAL MOBILE_SCREENS DRAW A REMOTE PHOTO — a listing cover, a gallery, an
// avatar, a message attachment thumbnail — all through `CachedNetworkImage`. Req
// 15.11 forbids a golden from performing a network read, and the fixtures already
// say so: `listing_fixtures.dart` records that its photo path "resolves to a URL
// that is never fetched", because the unresolved cover is exactly the state Req 5.2
// is about.
//
// WHAT WENT WRONG WITHOUT THIS FILE, STATED PLAINLY, BECAUSE IT IS THE KIND OF
// FAILURE THAT COMES BACK. `CachedNetworkImage` reaches `flutter_cache_manager`,
// which asks `path_provider` for a cache directory before it looks at the URL. In a
// `flutter test` process that plugin has no implementation, so the request throws
// `MissingPluginException` ASYNCHRONOUSLY — and where it lands depends on how many
// times the test yielded. A layout assertion that never awaits anything does not
// yield and never sees it; `expectGolden` awaits the comparison, so it landed inside
// the first capture and failed a test whose pixels were correct. The remaining
// throws arrived AFTER their test completed, which attributes a fault to whichever
// case happened to be running next. That is a flake with a moving blame target, and
// baking one into a reference image is worse than having no reference.
//
// SO BOTH ENDS ARE PINNED:
//
//   1. `path_provider` answers with a real temporary directory, so the cache
//      manager initialises instead of throwing.
//   2. Every HTTP request NEVER ANSWERS. Not a 404, not the test binding's stock
//      400 — nothing. The image stays in its loading state for the whole capture,
//      which is the state the fixtures declare and the only one that cannot depend
//      on when a response landed relative to a pump.
//
// A response that arrives, even a failing one, is a second frame the capture might
// or might not include. That is precisely the nondeterminism this whole harness
// exists to remove, so the stub refuses to produce one. Nothing is ever written to
// the cache either, because nothing ever resolves.
//
// IF A GOLDEN OF A LOADED PHOTO IS EVER WANTED, it needs a decoded fixture image
// handed to the widget, not a relaxed stub here. Answering requests with bytes would
// put the frame boundary back in play for every other case in the suite.
//
// Requirements 5.2, 9.5, 15.11.

import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// The `path_provider` plugin channel, named once.
const MethodChannel _pathProviderChannel =
    MethodChannel('plugins.flutter.io/path_provider');

/// Where the cache manager is told to live. Generated, ignored, and never written
/// to, because no request in this suite ever resolves.
const String kGoldenCacheDirectory = '.dart_tool/cardtrade_golden_cache';

bool _stubbed = false;

/// Makes every remote image request in this process hang, and gives the cache
/// manager somewhere to live.
///
/// Idempotent, and called from `setUpGoldenSuite` so no area test has to remember
/// it. Process-wide by nature: `HttpOverrides.global` and a mock channel handler
/// are both ambient, and the alternative — per-case setup — is the arrangement a
/// new case forgets.
void stubNetworkImages() {
  if (_stubbed) return;

  // Under `.dart_tool/`, which is generated and already ignored, rather than a
  // fresh system temporary directory per run: nothing is ever written into it
  // because nothing ever resolves, and a path that is the same every run is one
  // less thing that differs between two captures.
  final Directory cacheRoot = Directory(kGoldenCacheDirectory);
  if (!cacheRoot.existsSync()) {
    cacheRoot.createSync(recursive: true);
  }

  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(_pathProviderChannel, (MethodCall call) async {
    // Every directory query gets the same throwaway root. A test process has no
    // business distinguishing a documents directory from a cache one.
    return cacheRoot.path;
  });

  HttpOverrides.global = _UnansweredHttpOverrides();
  _stubbed = true;
}

class _UnansweredHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) =>
      _UnansweredHttpClient();
}

/// An `HttpClient` that accepts a request and never produces a response.
///
/// `noSuchMethod` rather than a full implementation: the surface of `HttpClient` is
/// large, and every member of it that a caller reaches here is one this suite does
/// not want answered. The returned future is a bare `Completer`'s, so nothing is
/// scheduled — a delayed future would arm a timer the binding then reports as
/// pending.
class _UnansweredHttpClient implements HttpClient {
  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.isSetter || invocation.memberName == #close) return null;
    return Completer<Never>().future;
  }
}
