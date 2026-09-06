// Feature: mobile-release-readiness — the handoff surfaces, and what they say
// before they take the screen away.
//
// THE DEFECT THESE TESTS PIN. A handoff that does not announce itself reads as an
// in-app capability right up to the moment the browser covers the app. The purchase
// control said "Confirm Purchase" beside a shopping-cart glyph and opened a website;
// the report sheet was a form that collected a member's evidence and discarded it;
// the avatar caption said profile pictures are set on the website and gave no way to
// get there. Req 12.2 is the rule that forbids the first, Req 12.5 the rest.
//
// WHY EVERY ASSERTION IS AN ADJACENCY AND NOT A `findsOneWidget`. "The words appear
// somewhere on the screen" is satisfied by a sentence three sections above the
// control, which a member scrolling to a button never reads. So each case locates
// the affordance, locates the announcement, and requires the second to be INSIDE the
// first or immediately above it — the two ways this codebase writes the pattern
// (`ProfileMenuRow(leavesApp: true)` puts the note in the row; a button takes it as
// the line directly above).
//
// THE ATTACHMENT CASE IS THE SAME RULE IN A NEW PLACE (Req 12.6). The
// `message-attachments` bucket is private and stays private (Req 12.7), so a phone
// cannot resolve a stored path — there is no participation-checked signing call on
// the mobile API, and the alternatives are a public bucket or a service-role key in
// an app bundle. A member who can see that a file exists with no way to open it is
// the Req 12.5 defect, so the placeholder carries a path to the thread on the web.
//
// Every provider is overridden with fixture data, so nothing here reads Supabase and
// nothing opens a browser: `WebHandoff.open` is not invoked by any assertion below.
//
// Validates: Requirements 12.2, 12.5, 12.6

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/core/web_handoff.dart';
import 'package:cardtrade/features/invites/screens/invite_screen.dart';
import 'package:cardtrade/features/listings/screens/listing_detail_screen.dart';
import 'package:cardtrade/features/messages/widgets/message_bubble.dart';
import 'package:cardtrade/features/profile/screens/edit_profile_screen.dart';
import 'package:cardtrade/features/profile/screens/my_profile_screen.dart';
import 'package:cardtrade/features/profile/screens/settings_screen.dart';
import 'package:cardtrade/features/profile/widgets/profile_sections.dart';
import 'package:cardtrade/features/sales/screens/purchase_flow_screen.dart';
import 'package:cardtrade/models/region.dart';
import 'package:cardtrade/providers/region_provider.dart';
import 'package:cardtrade/widgets/common/controls.dart';

import '../support/harness.dart';
import '../support/listing_fixtures.dart';
import '../support/message_fixtures.dart';
import '../support/state_fixtures.dart';

/// The two shapes an announcement is allowed to take, and nothing else.
///
/// Inside the affordance is the row form; immediately above it is the button form,
/// where "immediately" is one `section` step — the largest gap the existing surfaces
/// put between the sentence and the control it belongs to. A sentence further away
/// than that is a sentence about something else.
void expectAnnouncedOn(
  WidgetTester tester, {
  required Finder affordance,
  required Finder announcement,
  required String surface,
}) {
  expect(
    affordance,
    findsOneWidget,
    reason: '$surface: the affordance itself was not found',
  );
  expect(
    announcement,
    findsOneWidget,
    reason: '$surface: the departure is not announced anywhere',
  );

  final Rect control = tester.getRect(affordance);
  final Rect notice = tester.getRect(announcement);

  final bool inside = notice.top >= control.top - 0.01 &&
      notice.bottom <= control.bottom + 0.01 &&
      notice.left >= control.left - 0.01 &&
      notice.right <= control.right + 0.01;
  final bool immediatelyAbove = notice.bottom <= control.top + 0.01 &&
      control.top - notice.bottom <= AppSpacing.section;

  expect(
    inside || immediatelyAbove,
    isTrue,
    reason: '$surface: the announcement is on the screen but not on the '
        'affordance — notice at $notice, control at $control',
  );
}

/// Fails unless [notice] names its page and says the app is being left.
///
/// The page label is the part a member can act on: it is the only chance they get
/// to see where they are going, because the address bar belongs to a browser that
/// has not opened yet.
void expectNamesPage(String notice, Uri page, {required String surface}) {
  expect(
    notice,
    contains(WebHandoff.pageLabel(page)),
    reason: '$surface: the announcement does not name the page it opens',
  );
  expect(
    notice.contains('in your browser') || notice.contains('leave the app'),
    isTrue,
    reason: '$surface: the announcement does not say the app is being left',
  );
}

/// Every laid-out line of WORDS, with the icon font's glyphs dropped.
///
/// An `Icon` is a paragraph too, so a raw paragraph list of a bubble carrying the
/// outbound glyph reads `['Photo', '\uE89E', …]` — a code point, asserted against,
/// is a test about a font.
List<String> drawnWords(WidgetTester tester) => allParagraphs(tester)
    .where((RenderParagraph p) => p.text.style?.fontFamily != 'MaterialIcons')
    .map((RenderParagraph p) => p.text.toPlainText())
    .toList();

/// The text of the one announcement matching [fragment].
String noticeText(WidgetTester tester, String fragment) =>
    tester.widget<Text>(find.textContaining(fragment).first).data!;

/// Pumps [child] over [overrides] without settling.
///
/// Deliberately not `pumpAndSettle`: several of these screens hold a skeleton
/// pulsing behind an unresolved read, and a settle would time out on a loading
/// state rather than on a bug.
Future<void> pumpHandoff(
  WidgetTester tester,
  Widget child, {
  List<Override> overrides = const <Override>[],
  Size surface = kPhoneViewport,
}) async {
  await setViewport(tester, surface);
  await tester.pumpWidget(
    withOverrides(
      pumpFixture(child, reduceMotion: true, scaffold: false),
      overrides,
    ),
  );
  await tester.pump();
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 250));
}

/// The trailing note a [ProfileMenuRow] carries, as the row draws it.
Finder rowNote(String label, String note) => find.descendant(
      of: find.ancestor(
        of: find.text(label),
        matching: find.byType(ProfileMenuRow),
      ),
      matching: find.text(note),
    );

void main() {
  group('Req 12.2: an announced handoff states the departure on the control', () {
    testWidgets('the two verification steps each name their own page',
        (tester) async {
      await pumpHandoff(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(profile: makeAccountProfile()),
      );

      for (final (String label, Uri page) in <(String, Uri)>[
        ('Verify on the website', WebHandoff.identityVerification),
        ('Add payout details on the website', WebHandoff.payoutSetup),
      ]) {
        final Finder button = find.widgetWithText(AppButton, label);
        await tester.scrollUntilVisible(button, 200.0);
        await tester.pump();

        final String notice = noticeText(
          tester,
          'Opens ${WebHandoff.pageLabel(page)}',
        );
        expectNamesPage(notice, page, surface: label);
        expectAnnouncedOn(
          tester,
          affordance: button,
          announcement: find.text(notice),
          surface: label,
        );
      }

      await disposeStateSurface(tester);
    });

    testWidgets('the payout report row carries its note and the outbound glyph',
        (tester) async {
      await pumpHandoff(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(
          profile: makeAccountProfile(identityPassed: true, payoutPassed: true),
        ),
      );

      const String label = 'View your payouts';
      final Finder row = find.ancestor(
        of: find.text(label),
        matching: find.byType(ProfileMenuRow),
      );
      await tester.scrollUntilVisible(find.text(label), 200.0);
      await tester.pump();

      final String notice = noticeText(tester, 'Opens ');
      expectNamesPage(notice, WebHandoff.payoutReport, surface: label);
      expectAnnouncedOn(
        tester,
        affordance: row,
        announcement: rowNote(label, notice),
        surface: label,
      );

      // Req 10.6: a row that leaves the app wears the outbound glyph, never the
      // chevron that promises another screen of this app.
      expect(
        tester.widget<ProfileMenuRow>(row).leavesApp,
        isTrue,
        reason: 'an outbound row drawn as an inbound one',
      );

      await disposeStateSurface(tester);
    });

    testWidgets('terms and privacy each say which page they open', (tester) async {
      await pumpHandoff(tester, const SettingsScreen());

      for (final (String label, Uri page) in <(String, Uri)>[
        ('Terms of service', WebHandoff.terms),
        ('Privacy policy', WebHandoff.privacy),
      ]) {
        await tester.scrollUntilVisible(find.text(label), 200.0);
        await tester.pump();

        final String notice =
            'Opens ${WebHandoff.pageLabel(page)} in your browser';
        expectNamesPage(notice, page, surface: label);
        expectAnnouncedOn(
          tester,
          affordance:
              find.ancestor(of: find.text(label), matching: find.byType(ProfileMenuRow)),
          announcement: rowNote(label, notice),
          surface: label,
        );
      }
    });

    testWidgets('the avatar row is a path, not a caption', (tester) async {
      await pumpHandoff(
        tester,
        const EditProfileScreen(),
        overrides: <Override>[
          ...accountOverrides(profile: makeAccountProfile()),
          tradingRegionsProvider
              .overrideWith((ref) => Future<List<Region>>.value(<Region>[])),
        ],
      );

      const String label = 'Change your profile picture';
      final String notice =
          'Opens ${WebHandoff.pageLabel(WebHandoff.profile)} in your browser';
      expectNamesPage(notice, WebHandoff.profile, surface: label);
      expectAnnouncedOn(
        tester,
        affordance:
            find.ancestor(of: find.text(label), matching: find.byType(ProfileMenuRow)),
        announcement: rowNote(label, notice),
        surface: label,
      );

      // The caption this replaced claimed the capability and offered nothing.
      expect(find.textContaining('for now'), findsNothing);
    });

    testWidgets('the invite screen announces before it opens', (tester) async {
      const String token = 'invite-token-1';
      await pumpHandoff(tester, const InviteScreen(token: token));

      final Uri page = WebHandoff.invite(token);
      final String notice = noticeText(tester, 'Opens ');
      expectNamesPage(notice, page, surface: 'invite');
      expectAnnouncedOn(
        tester,
        affordance: find.widgetWithText(AppButton, 'Open this invite on the website'),
        announcement: find.text(notice),
        surface: 'invite',
      );
    });

    testWidgets('the purchase control names the page it opens', (tester) async {
      await pumpHandoff(
        tester,
        PurchaseFlowScreen(itemId: makeItem().id),
        overrides: listingDetailOverrides(item: makeItem()),
      );

      final Finder button = find
          .widgetWithText(FilledButton, 'Open this purchase on the website')
          .first;

      final String notice = noticeText(tester, 'Opens ');
      expectNamesPage(notice, WebHandoff.listing(makeItem().id), surface: 'purchase');
      expectAnnouncedOn(
        tester,
        affordance: button,
        announcement: find.text(notice),
        surface: 'purchase',
      );

      // Req 12.2: the control no longer describes an in-app purchase.
      expect(find.text('Confirm Purchase'), findsNothing);

      // This case ran at a 600-wide surface until the price preview stopped
      // overflowing a phone. It runs at `kPhoneViewport` like its neighbours now,
      // and this asserts it stays that way — the text-scale coverage is in
      // `purchase_flow_test.dart`.
      expectNoLayoutOverflow(tester);
    });

    testWidgets('the report sheet hands off instead of miming a form',
        (tester) async {
      await pumpHandoff(
        tester,
        ListingDetailScreen(itemId: makeItem().id),
        overrides: listingDetailOverrides(item: makeItem(), viewer: makeViewer()),
      );

      await tester.tap(find.bySemanticsLabel('Report this listing').first);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));

      final Uri page = WebHandoff.reportListing(makeItem().id);
      final String notice = noticeText(tester, 'Opens ');
      expectNamesPage(notice, page, surface: 'report');
      expectAnnouncedOn(
        tester,
        affordance: find.widgetWithText(
          AppButton,
          'Report this listing on the website',
        ),
        announcement: find.text(notice),
        surface: 'report',
      );

      // The form that discarded what a member wrote is gone, not hidden.
      expect(find.text('Submit report'), findsNothing);
      expect(find.byType(TextField), findsNothing);
    });
  });

  group('Req 12.6: an attachment says where it can be read', () {
    /// The notice a bubble in the fixture conversation carries.
    final Uri page = WebHandoff.conversation(kFixtureConversationId);
    final String notice = MessageBubble.attachmentHandoffNotice(page);

    testWidgets('an image with no signed URL carries the notice on a control',
        (tester) async {
      await pumpMessageSurface(
        tester,
        MessageBubble(message: makeImageMessage(), mine: false),
      );

      expectNamesPage(notice, page, surface: 'image attachment');
      expectAnnouncedOn(
        tester,
        affordance: find.ancestor(
          of: find.text(notice),
          matching: find.byType(InkWell),
        ),
        announcement: find.text(notice),
        surface: 'image attachment',
      );

      // Req 12.7: a placeholder, because the bucket is private. Nothing here asks
      // for a URL, and the bubble was handed none.
      expect(find.text('Photo'), findsOneWidget);
    });

    testWidgets('a document attachment carries it too', (tester) async {
      await pumpMessageSurface(
        tester,
        MessageBubble(message: makeFileMessage(), mine: false),
      );

      expect(find.text('grading-report.pdf'), findsOneWidget);
      expectAnnouncedOn(
        tester,
        affordance: find.ancestor(
          of: find.text(notice),
          matching: find.byType(InkWell),
        ),
        announcement: find.text(notice),
        surface: 'document attachment',
      );
    });

    testWidgets('an attachment-only message is never a blank bubble',
        (tester) async {
      // Migration 0102 allows a message with an attachment and no body. Before the
      // notice, such a message drew a thumbnail that never resolved and nothing
      // else — a member could not tell whether it had failed or was empty.
      await pumpMessageSurface(
        tester,
        MessageBubble(message: makeImageMessage(body: ''), mine: false),
      );

      expect(drawnWords(tester), <String>['Photo', notice]);
      expectNoLayoutOverflow(tester);
    });

    testWidgets('the notice is spoken as one activatable control',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpMessageSurface(
        tester,
        MessageBubble(message: makeFileMessage(), mine: false),
      );

      final List<SemanticsNode> outbound = actionableSemanticsNodes(tester)
          .where((SemanticsNode node) =>
              node.getSemanticsData().label.contains(WebHandoff.pageLabel(page)))
          .toList();
      expect(
        outbound,
        hasLength(1),
        reason: 'a screen reader is told the attachment opens on the website once',
      );

      handle.dispose();
    });

    testWidgets('a resolved image opens in the app rather than handing off',
        (tester) async {
      // The negative that keeps the notice honest: it is the branch for what this
      // client CANNOT open, so a bubble handed a URL must not carry it.
      await pumpMessageSurface(
        tester,
        MessageBubble(
          message: makeImageMessage(),
          mine: false,
          attachmentUrl: 'https://example.test/signed.jpg',
        ),
      );

      expect(find.text(notice), findsNothing);
      expectNoLayoutOverflow(tester);
    });
  });

  group('Req 12.7: nothing here asks the bucket to be public', () {
    test('a conversation handoff is a page, not a storage URL', () {
      final Uri page = WebHandoff.conversation(kFixtureConversationId);

      expect(page.path, '/messages/$kFixtureConversationId');
      for (final String forbidden in <String>[
        'storage',
        'message-attachments',
        'object/public',
        'sign',
      ]) {
        expect(
          page.toString(),
          isNot(contains(forbidden)),
          reason: 'the handoff reaches for storage instead of the thread',
        );
      }
    });
  });
}
