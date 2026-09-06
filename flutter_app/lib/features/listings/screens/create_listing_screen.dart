import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import 'package:cardtrade/core/constants.dart';
import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/error_view.dart';

/// Screen for creating a new listing — photo-first, with a sticky publish bar.
///
/// Every failure this form can present is presented INLINE, on the control it
/// concerns, and stays there until that control becomes valid (Req 8.5, 8.6). It
/// used to raise three of them — no image, no condition, and the server's own
/// refusal — in a snack bar, which is gone before a screen reader reaches the
/// control and never said which control it meant. Values are retained on every
/// failure, because the controllers outlive the submission (Req 8.11).
class CreateListingScreen extends ConsumerStatefulWidget {
  const CreateListingScreen({super.key});

  @override
  ConsumerState<CreateListingScreen> createState() =>
      _CreateListingScreenState();
}

class _CreateListingScreenState extends ConsumerState<CreateListingScreen> {
  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _fmvController = TextEditingController();
  final _locationController = TextEditingController();

  String? _selectedCategory;
  String? _selectedCondition;
  ListingKind _listingKind = ListingKind.single;
  final List<XFile> _images = [];
  bool _isSubmitting = false;
  bool _detailsExpanded = true;

  /// The currency the price field is denominated in.
  ///
  /// A new row's currency is derived server-side from the seller's region by the
  /// `set_row_currency_from_region` trigger, so this is the FIELD's presentation
  /// only, and AU is the sole trading region today. It decides how many digits the
  /// amount carries, which is why it is passed to `Money` rather than assumed.
  static const String _currency = 'aud';

  // Inline field failures. Each is rendered by the control it names.
  String? _titleError;
  String? _priceError;
  String? _descriptionError;
  String? _categoryError;
  String? _conditionError;
  String? _imagesError;

  /// A refusal the form cannot attach to a control it presents (Req 8.11).
  String? _formError;

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _fmvController.dispose();
    _locationController.dispose();
    super.dispose();
  }

  Future<void> _pickImages() async {
    final picker = ImagePicker();
    final picked = await picker.pickMultiImage(
      maxWidth: 1920,
      maxHeight: 1920,
      imageQuality: 85,
    );
    if (picked.isNotEmpty) {
      setState(() {
        final remaining = AppConstants.imagesMax - _images.length;
        _images.addAll(picked.take(remaining));
      });
    }
  }

  void _removeImage(int index) {
    setState(() => _images.removeAt(index));
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  //
  // The rules and the words are the ones the `Form` validators and the two snack
  // bars carried; only WHERE each message is presented has changed.

  static String? _validateTitle(String value) {
    if (value.trim().isEmpty) return 'Title is required';
    if (value.trim().length < 3) return 'Title must be at least 3 characters';
    return null;
  }

  static String? _validateDescription(String value) {
    if (value.trim().isEmpty) return 'Description is required';
    if (value.trim().length > AppConstants.descriptionMaxLength) {
      return 'Description is too long';
    }
    return null;
  }

  static String? _validatePrice(String value) {
    if (value.isEmpty) return 'Price is required';
    final int cents = Money.parseAmountText(value, _currency);
    if (cents <= 0) return 'Enter a valid price';
    if (cents > AppConstants.fmvMaxCents) return 'Price exceeds maximum allowed';
    return null;
  }

  /// Re-runs a control's validator once the form already carries a message, so a
  /// message clears as the member fixes it rather than surviving until submit.
  void _revalidate(void Function() apply) {
    if (_titleError == null &&
        _priceError == null &&
        _descriptionError == null &&
        _categoryError == null &&
        _conditionError == null &&
        _imagesError == null) {
      return;
    }
    setState(apply);
  }

  Future<void> _publish() async {
    final String? titleError = _validateTitle(_titleController.text);
    final String? priceError = _validatePrice(_fmvController.text);
    final String? descriptionError =
        _validateDescription(_descriptionController.text);
    final String? categoryError =
        _selectedCategory == null ? 'Please select a game' : null;
    final String? conditionError =
        _selectedCondition == null ? 'Please select a condition' : null;
    final String? imagesError =
        _images.isEmpty ? 'Add at least one image' : null;

    setState(() {
      _titleError = titleError;
      _priceError = priceError;
      _descriptionError = descriptionError;
      _categoryError = categoryError;
      _conditionError = conditionError;
      _imagesError = imagesError;
      _formError = null;
    });

    if (titleError != null ||
        priceError != null ||
        descriptionError != null ||
        categoryError != null ||
        conditionError != null ||
        imagesError != null) {
      // A closed Details section would hide the game and condition messages, so
      // the section that holds an invalid control is opened rather than the
      // member being told about a control they cannot see.
      if (categoryError != null || conditionError != null) {
        setState(() => _detailsExpanded = true);
      }
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      // Upload images to Storage
      final files = _images.map((xfile) => File(xfile.path)).toList();
      final List<String> imagePaths;
      try {
        imagePaths = await ref
            .read(storageServiceProvider)
            .uploadItemImages(files);
      } catch (e) {
        if (mounted) {
          setState(() => _imagesError = ErrorView.sanitise(e.toString()));
        }
        return;
      }

      if (!mounted) return;

      final service = ref.read(listingsServiceProvider);
      // Dollars text to integer minor units through the one formatter that knows
      // how many digits the currency has (Req 14.5).
      final fmvCents = Money.parseAmountText(_fmvController.text, _currency);

      await service.createItem(
        title: _titleController.text.trim(),
        description: _descriptionController.text.trim(),
        category: _selectedCategory!,
        condition: _selectedCondition!,
        fmvCents: fmvCents,
        imagePaths: imagePaths,
        listingKind: _listingKind == ListingKind.shopfront
            ? 'SHOPFRONT'
            : 'SINGLE',
        locationLabel: _locationController.text.isNotEmpty
            ? _locationController.text
            : null,
      );

      ref.invalidate(myListingsProvider);
      ref.invalidate(catalogProvider);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Listing published successfully!')),
        );
        context.pop();
      }
    } catch (e) {
      if (mounted) {
        setState(() => _formError = ErrorView.sanitise(e.toString()));
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sell'),
      ),
      body: Column(
        children: [
          // Scrollable form content. No `Form`: each control carries its own
          // message where Req 8.5 puts it, and `_publish` runs the same
          // validators in the same order.
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.group,
                AppSpacing.cozy,
                AppSpacing.group,
                AppSpacing.section,
              ),
              children: [
                // ─── 1. Photo Grid (top, prominent) ───────────────
                _PhotoGrid(
                  images: _images,
                  onAdd: _pickImages,
                  onRemove: _removeImage,
                ),
                if (_imagesError != null) ...[
                  const SizedBox(height: AppSpacing.tight),
                  Text(
                    _imagesError!,
                    softWrap: true,
                    style:
                        AppText.bodyText.copyWith(color: AppColors.destructive),
                  ),
                ],
                const SizedBox(height: AppSpacing.group),

                // ─── 2. Title ─────────────────────────────────────
                AppTextField(
                  controller: _titleController,
                  label: 'Title',
                  hint: 'What are you selling?',
                  maxLength: AppConstants.titleMaxLength,
                  errorText: _titleError,
                  onChanged: (value) => _revalidate(
                    () => _titleError = _validateTitle(value),
                  ),
                ),
                const SizedBox(height: AppSpacing.group),

                // ─── 3. Price ─────────────────────────────────────
                AppTextField(
                  controller: _fmvController,
                  label: 'Price',
                  hint: '0.00',
                  // The symbol lives inside the field, as the web's money input
                  // does, so the label does not have to name the currency.
                  prefixText: '${Money.symbolFor(_currency)} ',
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[\d.]')),
                  ],
                  errorText: _priceError,
                  onChanged: (value) => _revalidate(
                    () => _priceError = _validatePrice(value),
                  ),
                ),
                const SizedBox(height: AppSpacing.group),

                // ─── 4. Description ───────────────────────────────
                AppTextField(
                  controller: _descriptionController,
                  label: 'Description',
                  hint: 'Describe condition, provenance, any flaws...',
                  maxLength: AppConstants.descriptionMaxLength,
                  maxLines: null,
                  minLines: 4,
                  errorText: _descriptionError,
                  onChanged: (value) => _revalidate(
                    () => _descriptionError = _validateDescription(value),
                  ),
                ),
                const SizedBox(height: AppSpacing.group),

                // ─── 5. Collapsible Details Section ────────────────
                _buildDetailsSection(),
              ],
            ),
          ),

          // ─── 6. Sticky bottom publish bar ─────────────────────────
          _buildBottomBar(),
        ],
      ),
    );
  }

  Widget _buildDetailsSection() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border, width: AppMetrics.hairline),
      ),
      child: Column(
        children: [
          // Header / toggle
          Semantics(
            button: true,
            expanded: _detailsExpanded,
            label: 'Details',
            child: InkWell(
              onTap: () => setState(() => _detailsExpanded = !_detailsExpanded),
              borderRadius: BorderRadius.circular(AppRadius.lg),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.cozy,
                  vertical: AppSpacing.snug,
                ),
                child: ExcludeSemantics(
                  child: Row(
                    children: [
                      const Text('Details', style: AppText.sectionLabel),
                      const Spacer(),
                      AnimatedRotation(
                        turns: _detailsExpanded ? 0.5 : 0,
                        duration: const Duration(milliseconds: 200),
                        child: const Icon(
                          Icons.keyboard_arrow_down,
                          size: AppIconSize.large,
                          color: AppColors.mutedForeground,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),

          // Expandable content
          AnimatedCrossFade(
            firstChild: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.cozy,
                0,
                AppSpacing.cozy,
                AppSpacing.cozy,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Category
                  DropdownButtonFormField<String>(
                    initialValue: _selectedCategory,
                    decoration: InputDecoration(
                      label: const Text('Game', softWrap: true),
                      errorText: _categoryError,
                    ),
                    items: AppConstants.games
                        .map((c) =>
                            DropdownMenuItem(value: c, child: Text(c)))
                        .toList(),
                    onChanged: (val) => setState(() {
                      _selectedCategory = val;
                      _categoryError =
                          val == null ? 'Please select a game' : null;
                    }),
                  ),
                  const SizedBox(height: AppSpacing.group),

                  // Condition chips
                  AppChoiceChips<String>(
                    label: 'Condition',
                    options: AppConstants.conditions,
                    selected: _selectedCondition,
                    labelOf: (condition) => condition,
                    helperText: 'Select the condition of your item',
                    errorText: _conditionError,
                    onSelected: (condition) => setState(() {
                      _selectedCondition = condition;
                      _conditionError = condition == null
                          ? 'Please select a condition'
                          : null;
                    }),
                  ),
                  const SizedBox(height: AppSpacing.group),

                  // Listing kind
                  const Text('Listing type', style: AppText.bodyText),
                  const SizedBox(height: AppSpacing.snug),
                  SegmentedButton<ListingKind>(
                    segments: const [
                      ButtonSegment(
                        value: ListingKind.single,
                        label: Text('Single item'),
                        icon: Icon(Icons.style_outlined),
                      ),
                      ButtonSegment(
                        value: ListingKind.shopfront,
                        label: Text('Binder'),
                        icon: Icon(Icons.library_books_outlined),
                      ),
                    ],
                    selected: {_listingKind},
                    onSelectionChanged: (selection) {
                      setState(() => _listingKind = selection.first);
                    },
                  ),
                  if (_listingKind == ListingKind.shopfront) ...[
                    const SizedBox(height: AppSpacing.snug),
                    Container(
                      padding: const EdgeInsets.all(AppSpacing.snug),
                      decoration: BoxDecoration(
                        color: AppTint.caution.fill,
                        border: Border.all(
                          color: AppTint.caution.edge!,
                          width: AppMetrics.hairline,
                        ),
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                      ),
                      // Member copy always says nothing is held on a binder: on
                      // every other listing opening a contract reserves the goods.
                      child: Text(
                        'A binder or bulk listing lets buyers browse and request '
                        'specific cards. Nothing is held — several buyers can '
                        'negotiate at the same time.',
                        style: AppText.bodyText
                            .copyWith(color: AppTint.caution.ink),
                      ),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.group),

                  // Location
                  AppTextField(
                    controller: _locationController,
                    label: 'Location',
                    hint: 'City or suburb',
                    prefixIcon: const Icon(Icons.location_on_outlined),
                  ),
                ],
              ),
            ),
            secondChild: const SizedBox.shrink(),
            crossFadeState: _detailsExpanded
                ? CrossFadeState.showFirst
                : CrossFadeState.showSecond,
            duration: const Duration(milliseconds: 200),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomBar() {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.group,
        AppSpacing.snug,
        AppSpacing.group,
        AppSpacing.group,
      ),
      decoration: BoxDecoration(
        color: AppColors.card,
        border: const Border(
          top: BorderSide(color: AppColors.border, width: AppMetrics.hairline),
        ),
        boxShadow: AppElevation.market,
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Req 8.11: a refusal that names no field, or one this form does not
            // present, is summarised immediately above the control that submitted
            // it, and stays until the next submission.
            if (_formError != null) ...[
              AppFormSummary(message: _formError!),
              const SizedBox(height: AppSpacing.snug),
            ],
            // Drawn at 40 and touched at 48, and busy INSIDE those bounds, so the
            // bar does not change height while a member waits (Req 8.7, 8.10).
            AppButton(
              label: 'Publish',
              variant: AppButtonVariant.action,
              fillWidth: true,
              busy: _isSubmitting,
              onPressed: _publish,
            ),
          ],
        ),
      ),
    );
  }
}

/// Photo grid — 3 columns, add-photo tile first, thumbnails with remove and cover badge.
class _PhotoGrid extends StatelessWidget {
  const _PhotoGrid({
    required this.images,
    required this.onAdd,
    required this.onRemove,
  });

  final List<XFile> images;
  final VoidCallback onAdd;
  final void Function(int index) onRemove;

  @override
  Widget build(BuildContext context) {
    final showAddTile = images.length < AppConstants.imagesMax;
    final itemCount = images.length + (showAddTile ? 1 : 0);

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        mainAxisSpacing: AppSpacing.snug,
        crossAxisSpacing: AppSpacing.snug,
      ),
      itemCount: itemCount,
      itemBuilder: (context, index) {
        // Add photo tile is always first
        if (showAddTile && index == 0) {
          return _AddPhotoTile(
            count: images.length,
            onTap: onAdd,
          );
        }

        // Offset for image index when add tile is showing
        final imageIndex = showAddTile ? index - 1 : index;
        return _ImageThumbnail(
          file: images[imageIndex],
          isCover: imageIndex == 0,
          onRemove: () => onRemove(imageIndex),
        );
      },
    );
  }
}

/// Dashed-border add photo tile with camera icon and counter.
class _AddPhotoTile extends StatelessWidget {
  const _AddPhotoTile({
    required this.count,
    required this.onTap,
  });

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // The tile is the whole grid cell, so it is well past 48 on both axes and
    // needs no expansion — only a label, which it had none of (Req 13.7).
    return Semantics(
      button: true,
      label: 'Add photos, $count of ${AppConstants.imagesMax} added',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: ExcludeSemantics(
          child: CustomPaint(
            painter: _DashedBorderPainter(
              color: AppColors.border,
              radius: AppRadius.md,
            ),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: AppColors.muted,
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.camera_alt_outlined,
                    color: AppColors.mutedForeground,
                    size: AppIconSize.display,
                  ),
                  const SizedBox(height: AppSpacing.tight),
                  const Text('Add photo', style: AppText.metaText),
                  Text(
                    '$count/${AppConstants.imagesMax}',
                    style: AppText.metaText,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Paints a dashed border rectangle with rounded corners.
class _DashedBorderPainter extends CustomPainter {
  _DashedBorderPainter({required this.color, required this.radius});

  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;

    final path = Path()
      ..addRRect(RRect.fromRectAndRadius(
        Rect.fromLTWH(0, 0, size.width, size.height),
        Radius.circular(radius),
      ));

    // Draw dashed
    const dashWidth = 5.0;
    const dashSpace = 4.0;
    final pathMetrics = path.computeMetrics();
    for (final metric in pathMetrics) {
      double distance = 0;
      while (distance < metric.length) {
        final end = (distance + dashWidth).clamp(0.0, metric.length);
        final extractPath = metric.extractPath(distance, end);
        canvas.drawPath(extractPath, paint);
        distance += dashWidth + dashSpace;
      }
    }
  }

  @override
  bool shouldRepaint(_DashedBorderPainter oldDelegate) =>
      color != oldDelegate.color || radius != oldDelegate.radius;
}

/// Image thumbnail with remove button and optional cover badge.
class _ImageThumbnail extends StatelessWidget {
  const _ImageThumbnail({
    required this.file,
    required this.isCover,
    required this.onRemove,
  });

  final XFile file;
  final bool isCover;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        // Thumbnail image
        Semantics(
          button: true,
          label: 'Preview photo',
          child: InkWell(
            onTap: () => _showLocalImagePreview(context, file),
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.md),
              child: FutureBuilder<dynamic>(
                future: file.readAsBytes(),
                builder: (context, snapshot) {
                  if (snapshot.hasData) {
                    return Image.memory(
                      snapshot.data!,
                      fit: BoxFit.cover,
                      width: double.infinity,
                      height: double.infinity,
                    );
                  }
                  return const ColoredBox(
                    color: AppColors.muted,
                    child: Center(
                      child: SizedBox(
                        width: AppIconSize.large,
                        height: AppIconSize.large,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ),

        // Drawn at 32, touched at 48 — the separation lives in AppIconButton,
        // rather than the SizedBox(48) this used to inflate its layout with.
        Positioned(
          top: 0,
          right: 0,
          child: AppIconButton(
            icon: Icons.close_rounded,
            semanticLabel: 'Remove photo',
            visibleSize: AppMetrics.watchControl,
            iconSize: AppIconSize.button,
            background: AppTint.coverScrim.fill,
            foreground: AppColors.mist,
            onPressed: onRemove,
          ),
        ),

        // Cover badge on first image
        if (isCover)
          Positioned(
            bottom: 4,
            left: 4,
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: 6,
                vertical: 2,
              ),
              decoration: BoxDecoration(
                color: AppTint.binderMarker.fill,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Text(
                'Cover',
                style: AppText.badgeText.copyWith(color: AppColors.mist),
              ),
            ),
          ),
      ],
    );
  }
}

/// Shows a fullscreen dialog preview of a locally-picked image.
void _showLocalImagePreview(BuildContext context, XFile file) {
  // The dark surround is `--obsidian` with `--mist` ink, the theme's one declared
  // dark region — the same treatment `FullscreenImageViewer` gives a published
  // photo, so a picked one does not look like a different product. That shared
  // viewer cannot be reused here: it reads storage paths, and this file has not
  // been uploaded yet.
  showDialog(
    context: context,
    barrierColor: AppColors.obsidian,
    builder: (ctx) => Dialog.fullscreen(
      backgroundColor: AppColors.obsidian,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Center(
            child: FutureBuilder<dynamic>(
              future: file.readAsBytes(),
              builder: (context, snapshot) {
                if (snapshot.hasData) {
                  return InteractiveViewer(
                    child: Image.memory(
                      snapshot.data!,
                      fit: BoxFit.contain,
                    ),
                  );
                }
                return const SizedBox(
                  width: AppIconSize.display,
                  height: AppIconSize.display,
                  child: CircularProgressIndicator(
                    color: AppColors.mist,
                    strokeWidth: 2,
                  ),
                );
              },
            ),
          ),
          Positioned(
            top: MediaQuery.of(ctx).padding.top + AppSpacing.snug,
            left: AppSpacing.cozy,
            child: AppIconButton(
              icon: Icons.close_rounded,
              semanticLabel: 'Close preview',
              foreground: AppColors.mist,
              background: AppTint.coverScrim.fill,
              onPressed: () => Navigator.of(ctx).pop(),
            ),
          ),
        ],
      ),
    ),
  );
}
