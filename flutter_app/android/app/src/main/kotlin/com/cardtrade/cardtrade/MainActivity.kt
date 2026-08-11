package com.cardtrade.cardtrade

import io.flutter.embedding.android.FlutterFragmentActivity

/**
 * Hosts the Flutter engine.
 *
 * Extends FlutterFragmentActivity rather than FlutterActivity because
 * flutter_stripe presents its payment and card-setup sheets as fragments;
 * on a plain FlutterActivity those throw at presentation time.
 */
class MainActivity : FlutterFragmentActivity()
