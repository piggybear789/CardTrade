import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/widgets/common/controls.dart';

/// A chat message composer: one field, one send control, and the bounds Req 9.6
/// puts on both.
///
/// The field is an [AppTextField] like every other field in the client, so its
/// border, fill, focus colour and failure treatment come from Req 8 rather than
/// from a hand-tuned pill. What is specific to a composer is here: it opens at one
/// line, grows with the draft to at most four before scrolling its own content,
/// shortens again as the draft shortens, and refuses more than
/// [maxDraftLength] characters — the same ceiling the messages table's own body
/// check enforces, so the field stops a draft the server would reject anyway.
///
/// THE DRAFT SURVIVES A FAILED SEND (Req 9.7). [onSubmit] returns the failure's
/// own words, or null on success, and the field is cleared only on success — so a
/// refused send leaves the text exactly where it was, states what failed beside
/// the field, and can be sent again untouched. It previously cleared the field
/// before the request resolved and ignored the result, which lost the draft
/// silently on every failure.
///
/// Nothing is optimistically appended to the thread, so there is no unsent bubble
/// to remove: the realtime stream is the only thing that puts a message in the
/// list.
///
/// Staging an ATTACHMENT is not offered here. The mobile write API's send takes a
/// body and nothing else, and adding the upload would be a new capability rather
/// than a restyle — the gap is recorded in `.kiro/specs/mobile-parity/`.
///
/// Requirements 8.1–8.9, 9.6, 9.7, 13.6, 13.7.
class MessageInput extends StatefulWidget {
  const MessageInput({
    required this.onSubmit,
    this.enabled = true,
    super.key,
  });

  /// Sends [text]. Returns null when the send succeeded, or a member-facing
  /// explanation of what failed.
  final Future<String?> Function(String text) onSubmit;

  /// Whether the input is enabled.
  final bool enabled;

  /// The longest draft the composer accepts (Req 9.6).
  static const int maxDraftLength = 4000;

  /// The tallest the field grows before it scrolls its own content (Req 9.6).
  static const int maxDraftLines = 4;

  @override
  State<MessageInput> createState() => _MessageInputState();
}

class _MessageInputState extends State<MessageInput> {
  final TextEditingController _controller = TextEditingController();
  bool _hasText = false;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onTextChanged);
  }

  @override
  void dispose() {
    _controller.removeListener(_onTextChanged);
    _controller.dispose();
    super.dispose();
  }

  void _onTextChanged() {
    final bool hasText = _controller.text.trim().isNotEmpty;
    if (hasText != _hasText) {
      setState(() => _hasText = hasText);
    }
  }

  Future<void> _handleSubmit() async {
    final String text = _controller.text.trim();
    if (text.isEmpty || _sending) return;

    setState(() {
      _sending = true;
      _error = null;
    });

    final String? failure = await widget.onSubmit(text);

    if (!mounted) return;
    setState(() {
      _sending = false;
      _error = failure;
      // Req 9.7: the draft is returned to the field on failure. Clearing is the
      // success path only.
      if (failure == null) _controller.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final bool canSend = _hasText && widget.enabled && !_sending;

    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.card,
        border: Border(
          top: BorderSide(color: AppColors.border, width: AppMetrics.hairline),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.snug,
            vertical: AppSpacing.tight,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            // `snug` rather than `tight`: the send control is drawn at 40 with a 48
            // target, and 8 pixels is what keeps that target from intersecting the
            // field's (Req 13.6).
            spacing: AppSpacing.snug,
            children: <Widget>[
              // ─── Text Field ──────────────────────────────────────
              //
              // The composer's edge is the `--input` token like every other field's,
              // rather than the borderless pill it was: a field's edge is the only
              // thing identifying it as a control (Req 8.1).
              Expanded(
                child: AppTextField(
                  controller: _controller,
                  // Not disabled while sending: the member keeps their draft
                  // selectable and can keep typing, and a field that greys out
                  // mid-send reads as the draft having been taken away.
                  enabled: widget.enabled,
                  hint: 'Type a message...',
                  textCapitalization: TextCapitalization.sentences,
                  // One line at rest, four at most, then the field scrolls its own
                  // content rather than pushing the thread off the screen.
                  minLines: 1,
                  maxLines: MessageInput.maxDraftLines,
                  // A formatter rather than `maxLength`, which would draw a
                  // character counter under a chat composer.
                  inputFormatters: <TextInputFormatter>[
                    LengthLimitingTextInputFormatter(
                      MessageInput.maxDraftLength,
                    ),
                  ],
                  errorText: _error,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => _handleSubmit(),
                ),
              ),

              // ─── Send Button ─────────────────────────────────────
              //
              // The busy stand-in is drawn at the control's own 40 pixels, so the
              // row does not change height while a send is in flight (Req 8.10).
              if (_sending)
                SizedBox(
                  width: AppMetrics.controlHeight,
                  height: AppMetrics.controlHeight,
                  child: Semantics(
                    label: 'Sending message',
                    child: const Center(
                      child: SizedBox(
                        width: AppIconSize.large,
                        height: AppIconSize.large,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  ),
                )
              else
                AppIconButton(
                  icon: Icons.send_rounded,
                  semanticLabel: 'Send message',
                  iconSize: AppIconSize.large,
                  background: canSend ? AppColors.primary : AppColors.muted,
                  foreground: canSend
                      ? AppColors.primaryForeground
                      : AppColors.mutedForeground,
                  onPressed: canSend ? _handleSubmit : null,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
