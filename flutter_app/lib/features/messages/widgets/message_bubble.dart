// One message bubble, and the ONE place Req 9.2, 9.3 and 9.5 are drawn.
//
// The bubble carries no timestamp and no system variant any more: a run's single
// clock belongs to the run (Req 9.4) and a contract notice is not a bubble at all,
// so both moved up into `message_thread.dart`. What is left here is exactly the
// bubble — its pair of tokens, its bound, its corner and what it does with an
// attachment.
//
// The tokens are the web's: `--primary` on `--primary-foreground` for an own
// message and `--muted` on `--foreground` for a counterparty's. The previous
// pairing was `gold` on `obsidian`, an invented pair with no web counterpart, and
// the two bubbles were therefore two different products.
//
// AN ATTACHMENT THIS CLIENT CANNOT OPEN CARRIES A PATH TO ONE THAT CAN (Req 12.6).
// The `message-attachments` bucket is private and stays private (Req 12.7), so the
// bubble names the file and hands off to the conversation on the web rather than
// showing a member a thumbnail that never resolves.
//
// Requirements 9.2, 9.3, 9.5, 12.2, 12.6, 12.7, 13.6, 13.7, 13.10.

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/core/web_handoff.dart';
import 'package:cardtrade/models/message.dart';

/// A single chat message, aligned to the thread's trailing edge when [mine].
class MessageBubble extends StatelessWidget {
  const MessageBubble({
    required this.message,
    required this.mine,
    this.attachmentUrl,
    this.onOpenImage,
    super.key,
  });

  /// The message this bubble presents. Never a contract notice.
  final Message message;

  /// Whether the viewing member authored it.
  final bool mine;

  /// A resolved, short-lived URL for [Message.attachmentPath], or null.
  ///
  /// Null is a NORMAL state on this client, not a failure to pass an argument:
  /// the attachment bucket is private and signing a path needs the
  /// participation-checked server call the website makes, which the mobile write
  /// API does not expose. Without one the bubble still says a file is there and
  /// what it is called, which is strictly better than dropping it — see
  /// `.kiro/specs/mobile-parity/` for the gap.
  final String? attachmentUrl;

  /// Activated when an image thumbnail is tapped, to open it at full size.
  final VoidCallback? onOpenImage;

  /// The largest a thumbnail is drawn on either axis (Req 9.5).
  static const double thumbnailExtent = AppMetrics.attachmentThumb;

  /// What an attachment this client cannot open says for itself (Req 12.6).
  ///
  /// It NAMES the page, because a member cannot read the address bar of a browser
  /// that has not opened yet (Req 12.2), and it is one string so the visible line,
  /// the spoken label and the tests cannot drift into three wordings.
  static String attachmentHandoffNotice(Uri page) =>
      'View on the website. Opens ${WebHandoff.pageLabel(page)} in your browser.';

  /// A file size in the web's own words: `842 B`, `31 KB`, `2.4 MB`.
  static String formatAttachmentBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  Color get _fill => mine ? AppColors.primary : AppColors.muted;

  Color get _ink => mine ? AppColors.primaryForeground : AppColors.foreground;

  @override
  Widget build(BuildContext context) {
    final String text = message.body.trim();
    final bool hasText = text.isNotEmpty;
    final bool image = message.hasAttachment && message.isImageAttachment;
    final bool file = message.hasAttachment && !message.isImageAttachment;
    // Req 12.6: an attachment this client cannot render is not silently a dead
    // thumbnail. A resolved image URL is the only case the app can open itself;
    // everything else — an unsigned path, and every document — opens on the web.
    final bool opensOnWeb =
        message.hasAttachment && (attachmentUrl == null || file);

    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        // Req 9.3: at most 82 percent of the viewport, and the body WRAPS rather
        // than exceeding it. A fraction of the viewport rather than of the parent,
        // because the room embeds this inside its own padded column and a
        // fraction of that would be a different width in the two surfaces.
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width *
              AppMetrics.bubbleMaxWidthFraction,
        ),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: _fill,
            borderRadius: BorderRadius.circular(AppRadius.lg),
          ),
          // Clipped so an image attachment's corners follow the bubble's rather
          // than squaring it off at the top.
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (image) _imageAttachment(),
                if (file) _fileAttachment(),
                if (opensOnWeb) _webHandoff(context),
                // Req 9.5: an attachment-only message has NO body area and no
                // placeholder line. An empty `Text` would still occupy a line box
                // and read as a blank first line under the photo.
                if (hasText)
                  Padding(
                    padding: EdgeInsets.only(
                      left: AppSpacing.cozy,
                      right: AppSpacing.cozy,
                      top: message.hasAttachment
                          ? AppSpacing.tight
                          : AppSpacing.snug,
                      bottom: AppSpacing.snug,
                    ),
                    child: Text(
                      // Req 9.1: the author's own line breaks survive and a body
                      // of up to 4000 characters wraps onto as many lines as it
                      // needs. No `maxLines`, no `overflow`.
                      text,
                      softWrap: true,
                      style: AppText.bodyText.copyWith(color: _ink),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// The announced handoff under an attachment this client cannot open.
  ///
  /// Requesting a public bucket or shipping a service-role key would each turn the
  /// placeholder into a picture, and Req 12.7 forbids both — so the honest control
  /// is a path to the surface that can already sign one. Seeing that a file exists
  /// with no way to reach it is the Req 12.5 defect, which is why this is a
  /// TAPPABLE row and not a caption.
  Widget _webHandoff(BuildContext context) {
    final Uri page = WebHandoff.conversation(message.conversationId);
    final String notice = attachmentHandoffNotice(page);

    return Semantics(
      button: true,
      label: notice,
      child: InkWell(
        onTap: () => WebHandoff.openOrWarn(context, page),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: AppMetrics.minHitArea),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.cozy,
              vertical: AppSpacing.snug,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: AppSpacing.snug,
              children: <Widget>[
                ExcludeSemantics(
                  child: Icon(
                    // The outbound glyph every handoff wears, never a chevron.
                    Icons.open_in_new_rounded,
                    size: AppIconSize.base,
                    color: _ink,
                  ),
                ),
                Flexible(
                  child: ExcludeSemantics(
                    child: Text(
                      notice,
                      softWrap: true,
                      style: AppText.metaText.copyWith(color: _ink),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _imageAttachment() {
    final String? url = attachmentUrl;
    final String label = message.attachmentName ?? 'Photo';

    if (url == null) {
      // The unavailable branch, matching the web's when a path cannot be signed.
      // It is a labelled placeholder rather than a broken image box, and it keeps
      // the thumbnail's bound so the bubble does not resize if a URL arrives.
      return _Thumbnail(
        child: Center(
          child: Text(
            'Photo',
            style: AppText.metaText.copyWith(color: _ink),
          ),
        ),
      );
    }

    return Semantics(
      button: true,
      label: 'Open photo $label at full size',
      child: InkWell(
        onTap: onOpenImage,
        child: _Thumbnail(
          child: ExcludeSemantics(
            child: CachedNetworkImage(
              imageUrl: url,
              // Req 9.5: cropped to fill rather than distorted.
              fit: BoxFit.cover,
              placeholder: (BuildContext context, String _) => const SizedBox(),
              errorWidget: (BuildContext context, String _, Object _) => Center(
                child: Text(
                  'Photo unavailable',
                  style: AppText.metaText.copyWith(color: _ink),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _fileAttachment() {
    final String name = message.attachmentName ?? 'File';
    final int? bytes = message.attachmentBytes;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.cozy,
        vertical: AppSpacing.snug,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: AppSpacing.snug,
        children: <Widget>[
          ExcludeSemantics(
            child: Icon(
              Icons.description_outlined,
              size: AppIconSize.base,
              color: _ink,
            ),
          ),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  name,
                  softWrap: true,
                  style: AppText.bodyText
                      .copyWith(color: _ink, fontWeight: FontWeight.w600),
                ),
                if (bytes != null)
                  Text(
                    formatAttachmentBytes(bytes),
                    style: AppText.metaText.copyWith(color: _ink),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The 224-pixel box every image branch shares, so the bound is written once.
///
/// A BOUND rather than a fixed size, and the difference matters on a narrow
/// viewport: Req 9.3 caps the bubble at 82 percent of the width, which is under
/// 224 below about a 273-pixel screen, and a hard `SizedBox(224)` would overflow
/// its own bubble there. [AspectRatio] takes the largest square the bubble allows.
class _Thumbnail extends StatelessWidget {
  const _Thumbnail({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
        constraints: const BoxConstraints(
          maxWidth: MessageBubble.thumbnailExtent,
          maxHeight: MessageBubble.thumbnailExtent,
        ),
        child: AspectRatio(aspectRatio: 1, child: child),
      );
}
