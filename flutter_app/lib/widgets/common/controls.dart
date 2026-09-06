// The shared button and field primitives, and the ONE place the 40/48
// separation is applied to them.
//
// A control here is DRAWN at the height its web variant has at phone width —
// AppMetrics.controlHeight, 40 logical pixels at its largest — and is given a
// touch rectangle of at least AppMetrics.minHitArea through TapTarget, which
// expands the hit test without expanding layout. A screen therefore never
// re-derives the rule, and never reaches it by inflating a drawn height, which
// Req 8.7 forbids in as many words.
//
// Stage 6 added the rest of Req 8 here rather than at the call sites: the
// busy/awaiting-server treatment ([AppButton.busy]), the inline field failure
// ([AppTextField.errorText] and its announcement), the choice controls
// ([AppChoiceChips]) and the form-level summary ([AppFormSummary]). Every one of
// them was previously a snack bar or a hand-rolled Container on a screen, which
// is how three forms ended up disagreeing about where a validation failure goes.
//
// Requirements 8.1–8.11, 13.6, 13.7, 13.10, 13.11.

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';

import '../../core/theme.dart';
import 'tap_target.dart';

/// Which web button treatment a shared button wears.
enum AppButtonVariant {
  /// The web's pastel primary action: `--action` fill, `--action-foreground`
  /// label, `--action-border` edge, because a pastel fill needs a defined edge
  /// to read as a control (Req 6.8).
  action,

  /// The `--primary` iris fill, for a solid non-pastel affirmative.
  primary,

  /// A bordered, unfilled control.
  outline,

  /// `--destructive` fill, for an action a member cannot undo.
  destructive,
}

/// A text-labelled control drawn at 40 logical pixels with a 48-pixel target.
///
/// The height and the label level come from the themed button styles, so a
/// variant added to the theme is picked up here without a second definition.
class AppButton extends StatelessWidget {
  const AppButton({
    required this.label,
    required this.onPressed,
    this.variant = AppButtonVariant.action,
    this.icon,
    this.fillWidth = false,
    this.busy = false,
    super.key,
  });

  /// The button's visible label, rendered at the `body` level by the theme.
  final String label;

  /// Activation callback. A null callback presents the control as unavailable.
  final VoidCallback? onPressed;

  /// Whether this control is awaiting the result of a server call.
  ///
  /// A busy control wears the unavailable treatment (Req 8.9), carries a progress
  /// indicator INSIDE the bounds it already had, and reports itself as busy to a
  /// screen reader. It keeps its drawn height and its target, because the point of
  /// Req 8.10 is that a form does not move while a member waits on it.
  final bool busy;

  /// Which web treatment to wear.
  final AppButtonVariant variant;

  /// Optional leading glyph, drawn at [AppIconSize.base].
  final IconData? icon;

  /// Whether the button occupies the full width its parent offers.
  final bool fillWidth;

  /// The `--destructive` pair, layered over the themed filled-button style so the
  /// height, radius and label level still come from one place.
  static ButtonStyle get _destructiveStyle => FilledButton.styleFrom(
        backgroundColor: AppColors.destructive,
        foregroundColor: AppColors.destructiveForeground,
        disabledBackgroundColor: AppColors.muted,
        disabledForegroundColor: AppColors.mutedForeground,
      );

  @override
  Widget build(BuildContext context) {
    // A busy control cannot be activated, so its callback is dropped here rather
    // than at every call site: a screen that forgets the guard would otherwise
    // submit twice while its own spinner was on screen.
    final VoidCallback? effectiveOnPressed = busy ? null : onPressed;

    // The spinner is drawn OVER the label, never in place of it, and the label
    // and any leading glyph stay laid out at zero opacity. Req 8.10 says the
    // indicator sits "within the control's existing bounds rather than replacing
    // or resizing the control", and a spinner substituted FOR the label collapsed
    // a 186-pixel button to 48 the moment it was pressed — the form jumped under
    // the member's finger, which is the exact thing the criterion forbids. A
    // widget test measuring the two widths is what found it.
    //
    // `Opacity` rather than `Visibility(visible: false)`: both keep the layout,
    // but `Opacity` keeps ONE subtree, so the label cannot be measured one way
    // while a second copy is drawn another. Semantics is excluded for the whole
    // busy control below, so the unpainted label reaches no screen reader twice.
    const Widget spinner = SizedBox(
      width: AppIconSize.base,
      height: AppIconSize.base,
      child: CircularProgressIndicator(
        strokeWidth: 2,
        color: AppColors.mutedForeground,
      ),
    );
    final Widget labelWidget = busy
        ? Stack(
            alignment: Alignment.center,
            children: <Widget>[
              Opacity(opacity: 0, child: Text(label)),
              spinner,
            ],
          )
        : Text(label);
    final Widget? iconWidget = icon == null
        ? null
        : Opacity(
            opacity: busy ? 0 : 1,
            child: Icon(icon, size: AppIconSize.base),
          );

    final Widget button = switch (variant) {
      AppButtonVariant.action => iconWidget == null
          ? ElevatedButton(onPressed: effectiveOnPressed, child: labelWidget)
          : ElevatedButton.icon(
              onPressed: effectiveOnPressed,
              icon: iconWidget,
              label: labelWidget),
      AppButtonVariant.primary => iconWidget == null
          ? FilledButton(onPressed: effectiveOnPressed, child: labelWidget)
          : FilledButton.icon(
              onPressed: effectiveOnPressed,
              icon: iconWidget,
              label: labelWidget),
      AppButtonVariant.outline => iconWidget == null
          ? OutlinedButton(onPressed: effectiveOnPressed, child: labelWidget)
          : OutlinedButton.icon(
              onPressed: effectiveOnPressed,
              icon: iconWidget,
              label: labelWidget),
      AppButtonVariant.destructive => iconWidget == null
          ? FilledButton(
              onPressed: effectiveOnPressed,
              style: _destructiveStyle,
              child: labelWidget,
            )
          : FilledButton.icon(
              onPressed: effectiveOnPressed,
              icon: iconWidget,
              label: labelWidget,
              style: _destructiveStyle,
            ),
    };

    final Widget sized = fillWidth
        ? SizedBox(width: double.infinity, child: button)
        : button;

    // While busy the label is a spinner, so the button carries no visible text and
    // would reach a screen reader unlabelled (Req 13.7). The label is restated here
    // and `Waiting` is the busy report: Flutter's semantics model has no busy flag,
    // so the state is carried as a value, which persists without motion and
    // therefore satisfies Req 13.11 as well.
    if (!busy) return TapTarget(child: sized);
    return TapTarget(
      child: Semantics(
        button: true,
        enabled: false,
        label: label,
        value: 'Waiting for the server',
        child: ExcludeSemantics(child: sized),
      ),
    );
  }
}

/// A glyph-only control: drawn at [visibleSize], touched at 48.
///
/// [semanticLabel] is required rather than optional. A glyph-only control carries
/// no visible text, so an unlabelled one is unreachable by a screen reader
/// (Req 13.7), and making the label a parameter a call site can forget is how
/// that happens.
class AppIconButton extends StatelessWidget {
  const AppIconButton({
    required this.icon,
    required this.onPressed,
    required this.semanticLabel,
    this.visibleSize = AppMetrics.controlHeight,
    this.iconSize = AppIconSize.large,
    this.background,
    this.foreground,
    super.key,
  });

  /// The glyph to draw. Decorative: [semanticLabel] names the action.
  final IconData icon;

  /// Activation callback. A null callback presents the control as unavailable.
  final VoidCallback? onPressed;

  /// What this control does, in member-facing words.
  final String semanticLabel;

  /// Drawn diameter. 40 by default; a card's watch control passes
  /// [AppMetrics.watchControl], which is 32 and still gets a 48 target.
  final double visibleSize;

  /// Glyph box, one of the five [AppIconSize] steps.
  final double iconSize;

  /// Optional disc fill. Transparent by default, as the chrome's controls are.
  final Color? background;

  /// Glyph colour. `--foreground` by default.
  final Color? foreground;

  @override
  Widget build(BuildContext context) {
    final bool enabled = onPressed != null;

    // TapTarget is OUTSIDE the Semantics wrapper, and the order is load-bearing.
    // `RenderBox.hitTest` rejects a position outside its own `size` before it
    // ever consults a child, so any render box between the expansion and the
    // ancestor that forwards the touch clips the expansion away. With Semantics
    // on the outside the 32 dp control accepted touches in exactly 32 dp and the
    // 48 dp target was decorative (Req 13.6, Property 19).
    return TapTarget(
      child: Semantics(
        button: true,
        enabled: enabled,
        label: semanticLabel,
        child: SizedBox(
          width: visibleSize,
          height: visibleSize,
          child: Material(
            type: MaterialType.circle,
            color: background ?? Colors.transparent,
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onPressed,
              child: Center(
                child: ExcludeSemantics(
                  child: Icon(
                    icon,
                    size: iconSize,
                    color: enabled
                        ? (foreground ?? AppColors.foreground)
                        : AppColors.mutedForeground,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A single-line-or-more text field drawn at 40 logical pixels with a 48-pixel
/// target, and the field half of the same separation.
///
/// The border, fill, radius and message colours all come from the theme's
/// `inputDecorationTheme`, so this widget adds only what the theme cannot express:
/// the `lead` text level the web renders a field at on a phone (Req 8.3, 2.15),
/// the expanded touch rectangle, a label that WRAPS rather than ellipsises, and
/// the single announcement of a failure as it appears.
///
/// Stack fields at least [AppSpacing.group] apart. Two 40-pixel fields 16 apart
/// have 48-pixel targets with 8 pixels between them; at [AppSpacing.snug] the
/// targets would intersect, which Req 13.6 forbids.
///
/// A field with an [errorText] announces it ONCE as it appears and never moves
/// focus, so a member typing into the field it concerns is told about it without
/// being interrupted (Req 8.6). That is also why the message is never a snack bar:
/// a transient toast is gone before a screen reader reaches the field, and it does
/// not say which field it was about.
class AppTextField extends StatefulWidget {
  const AppTextField({
    this.controller,
    this.focusNode,
    this.label,
    this.hint,
    this.helperText,
    this.errorText,
    this.keyboardType,
    this.textInputAction,
    this.textCapitalization = TextCapitalization.none,
    this.inputFormatters,
    this.obscureText = false,
    this.enabled = true,
    this.maxLines = 1,
    this.minLines,
    this.maxLength,
    this.onChanged,
    this.onSubmitted,
    this.prefixIcon,
    this.prefixText,
    this.suffix,
    super.key,
  });

  final TextEditingController? controller;
  final FocusNode? focusNode;

  /// The field's label, rendered at the `body` level by the theme.
  final String? label;

  /// Placeholder copy shown while the field is empty.
  final String? hint;

  /// Supporting copy below the field, in `--muted-foreground` (Req 8.4).
  final String? helperText;

  /// A validation failure for this field. Presenting it draws the field's border
  /// in `--destructive` and keeps the message below the field (Req 8.5).
  final String? errorText;

  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final TextCapitalization textCapitalization;
  final List<TextInputFormatter>? inputFormatters;
  final bool obscureText;

  /// Whether the field accepts input. A disabled field keeps its drawn height
  /// and its target (Req 8.9).
  final bool enabled;

  final int? maxLines;
  final int? minLines;
  final int? maxLength;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final Widget? prefixIcon;

  /// Fixed copy inside the field, ahead of the value — a currency symbol on a
  /// money field, matching the web's `money-input.tsx`.
  final String? prefixText;

  final Widget? suffix;

  @override
  State<AppTextField> createState() => _AppTextFieldState();
}

class _AppTextFieldState extends State<AppTextField> {
  @override
  void didUpdateWidget(AppTextField oldWidget) {
    super.didUpdateWidget(oldWidget);
    final String? error = widget.errorText;
    // Absent → present only. A field that stays invalid keeps its message
    // rendered (Req 8.5) but must not re-announce it on every rebuild, which is
    // what a `liveRegion` would do — and a rebuild happens on every keystroke.
    if (error != null && error.isNotEmpty && oldWidget.errorText != error) {
      SemanticsService.sendAnnouncement(
        View.of(context),
        error,
        Directionality.of(context),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final bool enabled = widget.enabled;

    // Req 13.10 asks a line that no longer fits to REFLOW rather than ellipsise,
    // and Material builds `labelText` with `overflow: ellipsis`, which cuts the
    // end off a long label at a 2.0 text scale. A `label` WIDGET is ours to
    // configure, so the wrapping is explicit here rather than inherited.
    final Widget? labelWidget = widget.label == null
        ? null
        : Text(
            widget.label!,
            softWrap: true,
            overflow: TextOverflow.visible,
            style: AppText.bodyText.copyWith(color: AppColors.mutedForeground),
          );

    final Widget field = TextField(
      controller: widget.controller,
      focusNode: widget.focusNode,
      keyboardType: widget.keyboardType,
      textInputAction: widget.textInputAction,
      textCapitalization: widget.textCapitalization,
      inputFormatters: widget.inputFormatters,
      obscureText: widget.obscureText,
      enabled: enabled,
      maxLines: widget.obscureText ? 1 : widget.maxLines,
      minLines: widget.minLines,
      maxLength: widget.maxLength,
      onChanged: widget.onChanged,
      onSubmitted: widget.onSubmitted,
      style: AppType.lead.copyWith(
        color: enabled ? AppColors.foreground : AppColors.mutedForeground,
      ),
      cursorColor: AppColors.ring,
      decoration: InputDecoration(
        label: labelWidget,
        hintText: widget.hint,
        helperText: widget.helperText,
        errorText: widget.errorText,
        // Req 8.9: a control that cannot be activated is filled AND edged in
        // `--muted`, so the field reads as inert rather than merely empty.
        fillColor: enabled ? AppColors.card : AppColors.muted,
        // Material defaults both of these to one line, which at a 2.0 text scale
        // on a 320-pixel viewport cuts the end off a sentence — and an invalid
        // field whose reason is half-shown is worse than one with no reason.
        helperMaxLines: 3,
        errorMaxLines: 3,
        prefixIcon: widget.prefixIcon,
        prefixText: widget.prefixText,
        prefixStyle: AppType.lead.copyWith(color: AppColors.mutedForeground),
        suffix: widget.suffix,
        counterStyle: AppText.metaText,
        // The drawn height, not a hit area: the target is the TapTarget's job.
        constraints: const BoxConstraints(minHeight: AppMetrics.controlHeight),
      ),
    );

    return TapTarget(
      // The decorator renders the helper and the error as descendants of the
      // field, so merging their nodes is what makes a screen reader read the
      // field and its failure TOGETHER (Req 8.6) — without a second `hint`
      // annotation competing with the one the text field sets for itself.
      child: MergeSemantics(child: field),
    );
  }
}

/// A single-select choice row: the web's chip group, drawn as chips.
///
/// The selected pair is `--accent` fill with an `--accent-foreground` label
/// (Req 8.8), and selection also changes the label's WEIGHT and adds a check
/// glyph, so the state survives greyscale (Req 13.11).
///
/// The two gaps are deliberately different sizes. A chip is WIDER than 48, so
/// [TapTarget] adds nothing horizontally and [AppSpacing.snug] between two of them
/// is a real 8-pixel gap. It is SHORTER than 48, so each row's target grows
/// vertically by about 8 in each direction — two rows 8 apart would therefore have
/// intersecting targets, which Req 13.6 forbids, and the runs sit
/// [AppSpacing.group] apart instead.
class AppChoiceChips<T> extends StatelessWidget {
  const AppChoiceChips({
    required this.label,
    required this.options,
    required this.selected,
    required this.onSelected,
    required this.labelOf,
    this.helperText,
    this.errorText,
    this.enabled = true,
    super.key,
  });

  /// The group's label, at the `body` level like a field's.
  final String label;

  final List<T> options;
  final T? selected;

  /// Called with the chosen option, or null when the chosen one is deselected.
  final ValueChanged<T?> onSelected;

  /// The visible words for an option.
  final String Function(T option) labelOf;

  /// Supporting copy below the group, in `--muted-foreground` (Req 8.4).
  final String? helperText;

  /// A validation failure for this group, rendered where a field's would be:
  /// immediately below, at the `body` level, in `--destructive` (Req 8.5, 8.6).
  final String? errorText;

  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final bool invalid = errorText != null && errorText!.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(label, style: AppText.bodyText),
        const SizedBox(height: AppSpacing.snug),
        Wrap(
          spacing: AppSpacing.snug,
          runSpacing: AppSpacing.group,
          children: <Widget>[
            for (final T option in options)
              _ChoiceChip<T>(
                option: option,
                label: labelOf(option),
                isSelected: option == selected,
                enabled: enabled,
                onSelected: onSelected,
              ),
          ],
        ),
        if (invalid || helperText != null) ...<Widget>[
          const SizedBox(height: AppSpacing.tight),
          // One group, one message slot: the failure replaces the helper rather
          // than stacking above it, so the copy below a control never doubles in
          // height as it becomes invalid.
          Text(
            invalid ? errorText! : helperText!,
            softWrap: true,
            style: invalid
                ? AppText.bodyText.copyWith(color: AppColors.destructive)
                : AppText.supportText,
          ),
        ],
      ],
    );
  }
}

class _ChoiceChip<T> extends StatelessWidget {
  const _ChoiceChip({
    required this.option,
    required this.label,
    required this.isSelected,
    required this.enabled,
    required this.onSelected,
  });

  final T option;
  final String label;
  final bool isSelected;
  final bool enabled;
  final ValueChanged<T?> onSelected;

  @override
  Widget build(BuildContext context) {
    final Color ink = !enabled
        ? AppColors.mutedForeground
        : isSelected
            ? AppColors.accentForeground
            : AppColors.foreground;

    return TapTarget(
      child: ChoiceChip(
        label: Text(label),
        avatar: isSelected
            ? Icon(Icons.check_rounded, size: AppIconSize.button, color: ink)
            : null,
        selected: isSelected,
        onSelected: enabled ? (bool value) => onSelected(value ? option : null) : null,
        showCheckmark: false,
        backgroundColor: enabled ? AppColors.card : AppColors.muted,
        selectedColor: AppColors.accent,
        disabledColor: AppColors.muted,
        side: BorderSide(
          color: !enabled
              ? AppColors.muted
              : isSelected
                  ? AppColors.accentForeground
                  : AppColors.border,
          width: AppMetrics.hairline,
        ),
        labelStyle: AppText.bodyText.copyWith(
          color: ink,
          fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
        ),
      ),
    );
  }
}

/// The form-level failure summary: what a submission refused for, above the
/// control that submitted it.
///
/// Only for a failure that names NO field, or names one this form does not
/// present (Req 8.11). A failure that belongs to a visible field belongs on that
/// field, because a summary cannot say which of six fields to look at.
class AppFormSummary extends StatelessWidget {
  const AppFormSummary({required this.message, super.key});

  /// The failure's own words. Never an exception, an id or a provider name.
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.cozy),
      decoration: BoxDecoration(
        color: AppTint.alert.fill,
        border: Border.all(color: AppTint.alert.edge!, width: AppMetrics.hairline),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: AppSpacing.snug,
        children: <Widget>[
          // A glyph as well as the colour, so the summary is still a warning in
          // greyscale (Req 13.11).
          Icon(
            Icons.error_outline_rounded,
            size: AppIconSize.base,
            color: AppTint.alert.ink,
          ),
          Expanded(
            child: Semantics(
              liveRegion: true,
              child: Text(
                message,
                softWrap: true,
                style: AppText.bodyText.copyWith(color: AppTint.alert.ink),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
