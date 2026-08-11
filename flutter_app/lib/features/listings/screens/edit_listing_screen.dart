import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import 'package:cardtrade/core/constants.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/widgets/common/confirmation_dialog.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/loading_indicator.dart';

/// Screen for editing an existing listing.
///
/// Pre-populates the form with the current item data and allows updates.
/// Includes delete/close action in the app bar menu.
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
  final _formKey = GlobalKey<FormState>();
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

  /// Dollars string to integer cents using integer arithmetic only.
  /// `19.99` must be 1999 — `double * 100` gives 1998.
  static int _parseCents(String value) {
    final trimmed = value.replaceAll(RegExp(r'[^0-9.]'), '').trim();
    if (trimmed.isEmpty) return 0;
    final parts = trimmed.split('.');
    final whole = int.tryParse(parts[0]) ?? 0;
    if (parts.length == 1) return whole * 100;
    final fraction = parts[1].padRight(2, '0').substring(0, 2);
    return whole * 100 + (int.tryParse(fraction) ?? 0);
  }

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
    _fmvController.text = (item.fmvCents / 100).toStringAsFixed(2);
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

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_existingImages.isEmpty && _newImages.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please add at least one image')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      final service = ref.read(listingsServiceProvider);
      final fmvCents = _parseCents(_fmvController.text);

      // TODO: upload new images and combine with existing paths
      final allImages = [..._existingImages];

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
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update: $e')),
        );
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final itemAsync = ref.watch(itemDetailProvider(widget.itemId));
    final theme = Theme.of(context);

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
                          size: 18,
                          color: AppTheme.danger,
                        ),
                        const SizedBox(width: AppTheme.spacingSm),
                        Text(
                          item.isShopfront ? 'Close Binder' : 'Delete Listing',
                          style: const TextStyle(color: AppTheme.danger),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
          body: Form(
            key: _formKey,
            child: ListView(
              padding: const EdgeInsets.all(AppTheme.spacingLg),
              children: [
                // ─── Image Section ────────────────────────────────────
                Text('Photos', style: theme.textTheme.labelLarge),
                const SizedBox(height: AppTheme.spacingXs),
                Text(
                  '${_existingImages.length + _newImages.length}/${AppConstants.imagesMax} images',
                  style: theme.textTheme.bodySmall,
                ),
                const SizedBox(height: AppTheme.spacingSm),
                _EditImageGrid(
                  existingImages: _existingImages,
                  newImages: _newImages,
                  onAdd: _pickImages,
                  onRemoveExisting: _removeExistingImage,
                  onRemoveNew: _removeNewImage,
                ),
                const SizedBox(height: AppTheme.spacingXl),

                // ─── Title ────────────────────────────────────────────
                TextFormField(
                  controller: _titleController,
                  maxLength: AppConstants.titleMaxLength,
                  decoration: const InputDecoration(
                    labelText: 'Title',
                  ),
                  validator: (val) {
                    if (val == null || val.trim().isEmpty) {
                      return 'Title is required';
                    }
                    if (val.trim().length < 3) {
                      return 'Title must be at least 3 characters';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: AppTheme.spacingLg),

                // ─── Category ─────────────────────────────────────────
                DropdownButtonFormField<String>(
                  value: _selectedCategory,
                  decoration: const InputDecoration(labelText: 'Category'),
                  items: AppConstants.categories
                      .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                      .toList(),
                  onChanged: (val) => setState(() => _selectedCategory = val),
                  validator: (val) =>
                      val == null ? 'Please select a category' : null,
                ),
                const SizedBox(height: AppTheme.spacingLg),

                // ─── Condition ────────────────────────────────────────
                Text('Condition', style: theme.textTheme.labelLarge),
                const SizedBox(height: AppTheme.spacingSm),
                Wrap(
                  spacing: AppTheme.spacingSm,
                  children: AppConstants.conditions.map((cond) {
                    return ChoiceChip(
                      label: Text(cond),
                      selected: _selectedCondition == cond,
                      onSelected: (selected) {
                        setState(
                            () => _selectedCondition = selected ? cond : null);
                      },
                    );
                  }).toList(),
                ),
                const SizedBox(height: AppTheme.spacingLg),

                // ─── Description ──────────────────────────────────────
                TextFormField(
                  controller: _descriptionController,
                  maxLength: AppConstants.descriptionMaxLength,
                  maxLines: 5,
                  minLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Description',
                    alignLabelWithHint: true,
                  ),
                  validator: (val) {
                    if (val == null || val.trim().isEmpty) {
                      return 'Description is required';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: AppTheme.spacingLg),

                // ─── Listing Kind (read-only if shopfront already has contracts) ─
                Text('Listing type', style: theme.textTheme.labelLarge),
                const SizedBox(height: AppTheme.spacingSm),
                SegmentedButton<ListingKind>(
                  segments: const [
                    ButtonSegment(
                      value: ListingKind.single,
                      label: Text('Single Item'),
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
                const SizedBox(height: AppTheme.spacingLg),

                // ─── FMV ──────────────────────────────────────────────
                TextFormField(
                  controller: _fmvController,
                  decoration: InputDecoration(
                    labelText: _listingKind == ListingKind.shopfront
                        ? 'Collection value (indicative)'
                        : 'Price',
                    prefixText: '\$ ',
                  ),
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[\d.]')),
                  ],
                  validator: (val) {
                    if (val == null || val.isEmpty) return 'Price is required';
                    final parsed = double.tryParse(val);
                    if (parsed == null || parsed <= 0) {
                      return 'Enter a valid price';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: AppTheme.spacingLg),

                // ─── Location ─────────────────────────────────────────
                TextFormField(
                  controller: _locationController,
                  decoration: const InputDecoration(
                    labelText: 'Location',
                    hintText: 'City or suburb',
                    prefixIcon: Icon(Icons.location_on_outlined),
                  ),
                ),
                const SizedBox(height: AppTheme.spacingXxl),

                // ─── Actions ──────────────────────────────────────────
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _isSubmitting ? null : _save,
                    child: _isSubmitting
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Text('Save Changes'),
                  ),
                ),
                const SizedBox(height: AppTheme.spacingXxl),
              ],
            ),
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
        mainAxisSpacing: AppTheme.spacingSm,
        crossAxisSpacing: AppTheme.spacingSm,
      ),
      itemCount: totalImages + (canAdd ? 1 : 0),
      itemBuilder: (context, index) {
        // Add button at the end
        if (index == totalImages) {
          return GestureDetector(
            onTap: onAdd,
            child: Container(
              decoration: BoxDecoration(
                color: AppTheme.surfaceVariant,
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(color: AppTheme.border),
              ),
              child: const Icon(
                Icons.add_photo_alternate_outlined,
                color: AppTheme.muted,
                size: 28,
              ),
            ),
          );
        }

        // Existing image
        if (index < existingImages.length) {
          return Stack(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                child: Image.network(
                  existingImages[index],
                  fit: BoxFit.cover,
                  width: double.infinity,
                  height: double.infinity,
                ),
              ),
              Positioned(
                top: 4,
                right: 4,
                child: GestureDetector(
                  onTap: () => onRemoveExisting(index),
                  child: Container(
                    padding: const EdgeInsets.all(2),
                    decoration: const BoxDecoration(
                      color: AppTheme.danger,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.close,
                      size: 14,
                      color: Colors.white,
                    ),
                  ),
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
              borderRadius: BorderRadius.circular(AppTheme.radiusMd),
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
                  return Container(
                    color: AppTheme.surfaceVariant,
                    child: const Center(
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  );
                },
              ),
            ),
            Positioned(
              top: 4,
              right: 4,
              child: GestureDetector(
                onTap: () => onRemoveNew(newIndex),
                child: Container(
                  padding: const EdgeInsets.all(2),
                  decoration: const BoxDecoration(
                    color: AppTheme.danger,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.close,
                    size: 14,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
