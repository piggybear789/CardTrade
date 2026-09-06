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
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/widgets/common/confirmation_dialog.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/loading_indicator.dart';

/// Screen for editing an existing listing.
///
/// Pre-populates the form with the current item data and allows updates.
/// Includes delete/close action in the app bar menu.
///
/// Every field is an [AppTextField] and every failure is inline on the field it
/// concerns (Req 8.5, 8.6): a validation message in a snack bar is gone before a
/// screen reader reaches the field, and it never said which field it was about.
/// The submit control wears the busy treatment inside its own bounds (Req 8.10),
/// and a refusal that names no field lands in an [AppFormSummary] above it
/// (Req 8.11) with every entered value still in place.
class EditListingScreen extends ConsumerStatefulWidget {
  const EditListingScreen({
    required this.itemId,
    super.key,
  });

  final String itemId;

  @override
  ConsumerState<EditListingScreen> createState() => _EditListingScreenState();
}

class _EditListingScreenState extends ConsumerState<EditListingScreen> {
  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _fmvController = TextEditingController();
  final _locationController = TextEditingController();

  String? _selectedCategory;
  String? _selectedCondition;
  ListingKind _listingKind = ListingKind.single;
  List<String> _existingImages = [];
  final List<XFile> _newImages = [];
  bool _isSubmitting = false;
  bool _initialized = false;

  /// The currency this listing is denominated in, read off the row rather than
  /// assumed: it decides how many digits the price field holds.
  String _currency = 'aud';

  // Inline field failures. Each holds the message its own validator produced, and
  // each is rendered by the field it names (Req 8.5), never in a snack bar.
  String? _titleError;
  String? _categoryError;
  String? _descriptionError;
  String? _priceError;
  String? _imagesError;

  /// A failure the form cannot attach to a field it presents (Req 8.11). Stays
  /// rendered until the next submission.
  String? _formError;

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _fmvController.dispose();
    _locationController.dispose();
    super.dispose();
  }

  void _initFromItem(Item item) {
    if (_initialized) return;
    _initialized = true;
    _titleController.text = item.title;
    _descriptionController.text = item.description;
    // `Money.amountText`, not `fmvCents / 100`: the divisor belongs to
    // `minorUnitDigits`, and hand-writing 100 renders ¥12,345 as "123.45"
    // (Req 14.5).
    _currency = item.currency;
    _fmvController.text = Money.amountText(item.fmvCents, _currency);
    _locationController.text = item.locationLabel ?? '';
    _selectedCategory = item.category;
    _selectedCondition = item.condition;
    _listingKind = item.listingKind;
    _existingImages = List.from(item.imagePaths);
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
        final totalCurrent = _existingImages.length + _newImages.length;
        final remaining = AppConstants.imagesMax - totalCurrent;
        _newImages.addAll(picked.take(remaining));
      });
    }
  }

  void _removeExistingImage(int index) {
    setState(() => _existingImages.removeAt(index));
  }

  void _removeNewImage(int index) {
    setState(() => _newImages.removeAt(index));
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  //
  // The rules and the words are exactly the ones the `Form` validators carried;
  // only WHERE the message is presented has changed. Each returns null when the
  // value is acceptable, so a field that becomes valid loses its message
  // (Req 8.5).

  static String? _validateTitle(String value) {
    if (value.trim().isEmpty) return 'Title is required';
    if (value.trim().length < 3) return 'Title must be at least 3 characters';
    return null;
  }

  static String? _validateDescription(String value) {
    if (value.trim().isEmpty) return 'Description is required';
    return null;
  }

  String? _validatePrice(String value) {
    if (value.isEmpty) return 'Price is required';
    if (Money.parseAmountText(value, _currency) <= 0) return 'Enter a valid price';
    return null;
  }

  String? _validateCategory() =>
      _selectedCategory == null ? 'Please select a game' : null;

  /// Re-runs one field's validator once it already carries a message, so the
  /// message clears as the member fixes it rather than surviving until submit.
  void _revalidate(void Function() apply) {
    if (_titleError == null &&
        _descriptionError == null &&
        _priceError == null &&
        _categoryError == null &&
        _imagesError == null) {
      return;
    }
    setState(apply);
  }

  Future<void> _save() async {
    final String? titleError = _validateTitle(_titleController.text);
    final String? descriptionError = _validateDescription(_descriptionController.text);
    final String? priceError = _validatePrice(_fmvController.text);
    final String? categoryError = _validateCategory();
    final bool noImages = _existingImages.isEmpty && _newImages.isEmpty;

    setState(() {
      _titleError = titleError;
      _descriptionError = descriptionError;
      _priceError = priceError;
      _categoryError = categoryError;
      // Photos are a group rather than a field, so its failure sits with the
      // group's own label — the position criterion 5 gives a field's message.
      _imagesError = noImages ? 'Add at least one image' : null;
      _formError = null;
    });

    if (titleError != null ||
        descriptionError != null ||
        priceError != null ||
        categoryError != null ||
        noImages) {
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      final service = ref.read(listingsServiceProvider);
      final fmvCents = Money.parseAmountText(_fmvController.text, _currency);

      // The picked photos are UPLOADED, not dropped (Req 12.5). This was a
      // `TODO` beside `[..._existingImages]`: the grid let a member add photos,
      // drew their thumbnails, and then saved the listing without them while
      // reporting success — a control for a capability the screen did not
      // perform. The upload is the same `StorageService` call the create screen
      // makes, so there is one definition of where an item image lands.
      final List<String> allImages = [..._existingImages];
      if (_newImages.isNotEmpty) {
        final List<File> files =
            _newImages.map((XFile picked) => File(picked.path)).toList();
        try {
          allImages.addAll(
            await ref.read(storageServiceProvider).uploadItemImages(files),
          );
        } catch (e) {
          // A photo that did not upload belongs on the photo group, which is
          // where its own message already goes (Req 8.5).
          if (mounted) {
            setState(() => _imagesError = ErrorView.sanitise(e.toString()));
          }
          return;
        }
      }
      if (!mounted) return;

      await service.updateItem(widget.itemId, {
        'title': _titleController.text.trim(),
        'description': _descriptionController.text.trim(),
        'category': _selectedCategory,
        'condition': _selectedCondition,
        'fmv_cents': fmvCents,
        'image_paths': allImages,
        'location_label': _locationController.text.isNotEmpty
            ? _locationController.text
            : null,
      });

      ref.invalidate(itemDetailProvider(widget.itemId));
      ref.invalidate(myListingsProvider);
      ref.invalidate(catalogProvider);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Listing updated successfully')),
        );
        context.pop();
      }
    } catch (e) {
      // A refusal that names no field is a form-level summary above the submit
      // control, not a toast (Req 8.11), and it is sanitised on the way there so
      // a provider identifier cannot reach a member's screen.
      if (mounted) {
        setState(() => _formError = ErrorView.sanitise(e.toString()));
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _deleteOrClose(Item item) async {
    final isShopfront = item.isShopfront;
    final action = isShopfront ? 'Close' : 'Delete';
    final message = isShopfront
        ? 'Close this binder? Existing contracts will continue, but no new ones can be opened.'
        : 'Delete this listing? This action cannot be undone.';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => ConfirmationDialog(
        title: '$action listing',
        message: message,
        confirmLabel: action,
        isDanger: true,
      ),
    );

    if (confirmed != true || !mounted) return;

    try {
      final service = ref.read(listingsServiceProvider);
      if (isShopfront) {
        await service.closeShopfront(widget.itemId);
      } else {
        await service.updateItem(widget.itemId, {'hidden': true});
      }

      ref.invalidate(myListingsProvider);
      ref.invalidate(catalogProvider);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Listing ${action.toLowerCase()}d')),
        );
        context.pop();
      }
    } catch (e) {
      if (mounted) {
        setState(() => _formError = ErrorView.sanitise(e.toString()));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final itemAsync = ref.watch(itemDetailProvider(widget.itemId));

    return itemAsync.when(
      loading: () => const Scaffold(
        body: Center(child: LoadingIndicator()),
      ),
      error: (error, _) => Scaffold(
        appBar: AppBar(),
        body: ErrorView(
          message: error.toString(),
          onRetry: () => ref.invalidate(itemDetailProvider(widget.itemId)),
        ),
      ),
      data: (item) {
        if (item == null) {
          return Scaffold(
            appBar: AppBar(),
            body: const ErrorView(
              title: 'Listing not found',
              message: 'This listing may have been removed.',
            ),
          );
        }

        _initFromItem(item);

        return Scaffold(
          appBar: AppBar(
            title: const Text('Edit Listing'),
            actions: [
              PopupMenuButton<String>(
                onSelected: (value) {
                  if (value == 'delete') _deleteOrClose(item);
                },
                itemBuilder: (_) => [
                  PopupMenuItem(
                    value: 'delete',
                    child: Row(
                      children: [
                        Icon(
                          item.isShopfront
                              ? Icons.close_rounded
                              : Icons.delete_outline_rounded,
                          size: AppIconSize.large,
                          color: AppColors.destructive,
                        ),
                        const SizedBox(width: AppSpacing.tight),
                        Text(
                          item.isShopfront
                              ? 'Close this listing'
                              : 'Delete listing',
                          style: AppText.bodyText
                              .copyWith(color: AppColors.destructive),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
          // No `Form`: each field carries its own message in the position
          // Req 8.5 gives it, and the submit path runs the same validators in
          // the same order. Fields are stacked at `group` so their 48-pixel
          // targets do not intersect (Req 13.6).
          body: ListView(
            padding: const EdgeInsets.all(AppSpacing.cozy),
            children: [
              // ─── Image Section ────────────────────────────────────
              const Text('Photos', style: AppText.bodyText),
              const SizedBox(height: AppSpacing.snug),
              Text(
                '${_existingImages.length + _newImages.length}/${AppConstants.imagesMax} images',
                style: AppText.supportText,
              ),
              const SizedBox(height: AppSpacing.tight),
              _EditImageGrid(
                existingImages: _existingImages,
                newImages: _newImages,
                onAdd: _pickImages,
                onRemoveExisting: _removeExistingImage,
                onRemoveNew: _removeNewImage,
              ),
              if (_imagesError != null) ...[
                const SizedBox(height: AppSpacing.tight),
                Text(
                  _imagesError!,
                  softWrap: true,
                  style: AppText.bodyText.copyWith(color: AppColors.destructive),
                ),
              ],
              const SizedBox(height: AppSpacing.group),

              // ─── Title ────────────────────────────────────────────
              AppTextField(
                controller: _titleController,
                label: 'Title',
                maxLength: AppConstants.titleMaxLength,
                errorText: _titleError,
                onChanged: (value) => _revalidate(
                  () => _titleError = _validateTitle(value),
                ),
              ),
              const SizedBox(height: AppSpacing.group),

              // ─── Category ─────────────────────────────────────────
              DropdownButtonFormField<String>(
                // Guarded, unlike the create screen: an existing listing may carry a
                // category from before 0104 that is not in `games`, and the dropdown
                // throws when its value is absent from `items`.
                initialValue: AppConstants.games.contains(_selectedCategory)
                    ? _selectedCategory
                    : null,
                decoration: InputDecoration(
                  label: const Text('Game', softWrap: true),
                  errorText: _categoryError,
                ),
                items: AppConstants.games
                    .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                    .toList(),
                onChanged: (val) => setState(() {
                  _selectedCategory = val;
                  _categoryError = _validateCategory();
                }),
              ),
              const SizedBox(height: AppSpacing.group),

              // ─── Condition ────────────────────────────────────────
              AppChoiceChips<String>(
                label: 'Condition',
                options: AppConstants.conditions,
                selected: _selectedCondition,
                labelOf: (condition) => condition,
                onSelected: (condition) =>
                    setState(() => _selectedCondition = condition),
              ),
              const SizedBox(height: AppSpacing.group),

              // ─── Description ──────────────────────────────────────
              AppTextField(
                controller: _descriptionController,
                label: 'Description',
                maxLength: AppConstants.descriptionMaxLength,
                maxLines: 5,
                minLines: 3,
                errorText: _descriptionError,
                onChanged: (value) => _revalidate(
                  () => _descriptionError = _validateDescription(value),
                ),
              ),
              const SizedBox(height: AppSpacing.group),

              // ─── Listing Kind ─────────────────────────────────────
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
              const SizedBox(height: AppSpacing.group),

              // ─── FMV ──────────────────────────────────────────────
              AppTextField(
                controller: _fmvController,
                label: _listingKind == ListingKind.shopfront
                    ? 'Collection value (indicative)'
                    : 'Price',
                // The symbol sits inside the field, as the web's money input does,
                // so the label does not have to name the currency.
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

              // ─── Location ─────────────────────────────────────────
              AppTextField(
                controller: _locationController,
                label: 'Location',
                hint: 'City or suburb',
                prefixIcon: const Icon(Icons.location_on_outlined),
              ),
              const SizedBox(height: AppSpacing.section),

              // ─── Actions ──────────────────────────────────────────
              if (_formError != null) ...[
                AppFormSummary(message: _formError!),
                const SizedBox(height: AppSpacing.cozy),
              ],
              AppButton(
                label: 'Save changes',
                variant: AppButtonVariant.primary,
                fillWidth: true,
                busy: _isSubmitting,
                onPressed: _save,
              ),
              const SizedBox(height: AppSpacing.section),
            ],
          ),
        );
      },
    );
  }
}

/// Image grid for edit mode showing existing URLs and new local picks.
class _EditImageGrid extends StatelessWidget {
  const _EditImageGrid({
    required this.existingImages,
    required this.newImages,
    required this.onAdd,
    required this.onRemoveExisting,
    required this.onRemoveNew,
  });

  final List<String> existingImages;
  final List<XFile> newImages;
  final VoidCallback onAdd;
  final void Function(int) onRemoveExisting;
  final void Function(int) onRemoveNew;

  @override
  Widget build(BuildContext context) {
    final totalImages = existingImages.length + newImages.length;
    final canAdd = totalImages < AppConstants.imagesMax;

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        mainAxisSpacing: AppSpacing.tight,
        crossAxisSpacing: AppSpacing.tight,
      ),
      itemCount: totalImages + (canAdd ? 1 : 0),
      itemBuilder: (context, index) {
        // Add button at the end
        if (index == totalImages) {
          return Semantics(
            button: true,
            label: 'Add photos',
            child: InkWell(
              onTap: onAdd,
              borderRadius: BorderRadius.circular(AppRadius.md),
              child: Container(
                decoration: BoxDecoration(
                  color: AppColors.muted,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(
                    color: AppColors.border,
                    width: AppMetrics.hairline,
                  ),
                ),
                child: const ExcludeSemantics(
                  child: Icon(
                    Icons.add_photo_alternate_outlined,
                    color: AppColors.mutedForeground,
                    size: AppIconSize.display,
                  ),
                ),
              ),
            ),
          );
        }

        // Existing image
        if (index < existingImages.length) {
          return Stack(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.md),
                child: Image.network(
                  existingImages[index],
                  fit: BoxFit.cover,
                  width: double.infinity,
                  height: double.infinity,
                ),
              ),
              // Drawn at 32 in the corner of a thumbnail, touched at 48 — the
              // separation lives in AppIconButton, and the label is required
              // there rather than optional (Req 13.6, 13.7).
              Positioned(
                top: 0,
                right: 0,
                child: AppIconButton(
                  icon: Icons.close_rounded,
                  semanticLabel: 'Remove image ${index + 1}',
                  visibleSize: AppMetrics.watchControl,
                  iconSize: AppIconSize.button,
                  background: AppColors.destructive,
                  foreground: AppColors.destructiveForeground,
                  onPressed: () => onRemoveExisting(index),
                ),
              ),
            ],
          );
        }

        // New image
        final newIndex = index - existingImages.length;
        return Stack(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.md),
              child: FutureBuilder<dynamic>(
                future: newImages[newIndex].readAsBytes(),
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
            Positioned(
              top: 0,
              right: 0,
              child: AppIconButton(
                icon: Icons.close_rounded,
                semanticLabel:
                    'Remove image ${existingImages.length + newIndex + 1}',
                visibleSize: AppMetrics.watchControl,
                iconSize: AppIconSize.button,
                background: AppColors.destructive,
                foreground: AppColors.destructiveForeground,
                onPressed: () => onRemoveNew(newIndex),
              ),
            ),
          ],
        );
      },
    );
  }
}
