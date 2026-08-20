import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import 'package:cardtrade/core/constants.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/providers/listings_provider.dart';

/// Screen for creating a new listing — Xianyu/FB-Marketplace quick-list style.
///
/// Photo-first, minimal form with sticky publish bar. Fixes the image upload
/// bug (images are uploaded to Storage before createItem is called).
class CreateListingScreen extends ConsumerStatefulWidget {
  const CreateListingScreen({super.key});

  @override
  ConsumerState<CreateListingScreen> createState() =>
      _CreateListingScreenState();
}

class _CreateListingScreenState extends ConsumerState<CreateListingScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _fmvController = TextEditingController();
  final _locationController = TextEditingController();

  String? _selectedCategory;
  String? _selectedCondition;
  ListingKind _listingKind = ListingKind.single;
  final List<XFile> _images = [];
  bool _isSubmitting = false;
  String _submitLabel = 'Publish';
  bool _detailsExpanded = true;

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _fmvController.dispose();
    _locationController.dispose();
    super.dispose();
  }

  /// Parses a dollar string to integer cents without float precision loss.
  int _parseCents(String value) {
    if (value.isEmpty) return 0;
    final parts = value.split('.');
    final whole = int.tryParse(parts[0]) ?? 0;
    final fraction = parts.length > 1
        ? parts[1].padRight(2, '0').substring(0, 2)
        : '00';
    return whole * 100 + (int.tryParse(fraction) ?? 0);
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

  Future<void> _publish() async {
    if (!_formKey.currentState!.validate()) return;
    if (_images.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please add at least one image')),
      );
      return;
    }
    if (_selectedCondition == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a condition')),
      );
      return;
    }

    setState(() {
      _isSubmitting = true;
      _submitLabel = 'Uploading images...';
    });

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
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Image upload failed: $e')),
          );
        }
        return;
      }

      if (!mounted) return;
      setState(() => _submitLabel = 'Publishing...');

      final service = ref.read(listingsServiceProvider);
      // Parse FMV from dollar string to cents without float precision loss
      final fmvCents = _parseCents(
          _fmvController.text.replaceAll(RegExp(r'[^0-9.]'), ''));

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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to publish: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _submitLabel = 'Publish';
        });
      }
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
          // Scrollable form content
          Expanded(
            child: Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  AppTheme.spacingXl,
                  AppTheme.spacingLg,
                  AppTheme.spacingXl,
                  AppTheme.spacingXxl,
                ),
                children: [
                  // ─── 1. Photo Grid (top, prominent) ───────────────
                  _PhotoGrid(
                    images: _images,
                    onAdd: _pickImages,
                    onRemove: _removeImage,
                  ),
                  const SizedBox(height: AppTheme.spacingXl),

                  // ─── 2. Title ─────────────────────────────────────
                  TextFormField(
                    controller: _titleController,
                    maxLength: AppConstants.titleMaxLength,
                    style: Theme.of(context).textTheme.titleLarge,
                    decoration: InputDecoration(
                      hintText: 'What are you selling?',
                      hintStyle: Theme.of(context).textTheme.titleLarge?.copyWith(
                        color: AppTheme.muted,
                      ),
                      counterStyle: AppTheme.metaText,
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

                  // ─── 3. Price ─────────────────────────────────────
                  TextFormField(
                    controller: _fmvController,
                    style: AppTheme.priceCard.copyWith(fontSize: 18),
                    decoration: InputDecoration(
                      prefixText: '\$ ',
                      prefixStyle: AppTheme.priceCard.copyWith(
                        fontSize: 18,
                        color: AppTheme.gold,
                      ),
                      hintText: '0.00',
                      hintStyle: AppTheme.priceCard.copyWith(
                        fontSize: 18,
                        color: AppTheme.muted,
                      ),
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
                      final cents = _parseCents(val);
                      if (cents > AppConstants.fmvMaxCents) {
                        return 'Price exceeds maximum allowed';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: AppTheme.spacingLg),

                  // ─── 4. Description ───────────────────────────────
                  TextFormField(
                    controller: _descriptionController,
                    maxLength: AppConstants.descriptionMaxLength,
                    maxLines: null,
                    minLines: 4,
                    style: AppTheme.bodyText,
                    decoration: InputDecoration(
                      hintText:
                          'Describe condition, provenance, any flaws...',
                      hintStyle: AppTheme.bodyText.copyWith(
                        color: AppTheme.muted,
                      ),
                      alignLabelWithHint: true,
                      counterStyle: AppTheme.metaText,
                    ),
                    validator: (val) {
                      if (val == null || val.trim().isEmpty) {
                        return 'Description is required';
                      }
                      if (val.trim().length > AppConstants.descriptionMaxLength) {
                        return 'Description is too long';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: AppTheme.spacingLg),

                  // ─── 5. Collapsible Details Section ────────────────
                  _buildDetailsSection(),
                ],
              ),
            ),
          ),

          // ─── 6. Sticky bottom publish bar ─────────────────────────
          _buildBottomBar(),
        ],
      ),
    );
  }

  Widget _buildDetailsSection() {
    final theme = Theme.of(context);

    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: AppTheme.border, width: 0.5),
      ),
      child: Column(
        children: [
          // Header / toggle
          InkWell(
            onTap: () => setState(() => _detailsExpanded = !_detailsExpanded),
            borderRadius: BorderRadius.circular(AppTheme.radiusLg),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.spacingLg,
                vertical: AppTheme.spacingMd,
              ),
              child: Row(
                children: [
                  const Text(
                    'Details',
                    style: AppTheme.sectionLabel,
                  ),
                  const Spacer(),
                  AnimatedRotation(
                    turns: _detailsExpanded ? 0.5 : 0,
                    duration: const Duration(milliseconds: 200),
                    child: const Icon(
                      Icons.keyboard_arrow_down,
                      size: 20,
                      color: AppTheme.secondary,
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Expandable content
          AnimatedCrossFade(
            firstChild: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppTheme.spacingLg,
                0,
                AppTheme.spacingLg,
                AppTheme.spacingLg,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Category
                  DropdownButtonFormField<String>(
                    initialValue: _selectedCategory,
                    decoration: InputDecoration(
                      hintText: 'Category',
                      hintStyle: AppTheme.bodyText.copyWith(
                        color: AppTheme.muted,
                      ),
                    ),
                    items: AppConstants.categories
                        .map((c) =>
                            DropdownMenuItem(value: c, child: Text(c)))
                        .toList(),
                    onChanged: (val) =>
                        setState(() => _selectedCategory = val),
                    validator: (val) =>
                        val == null ? 'Please select a category' : null,
                  ),
                  const SizedBox(height: AppTheme.spacingLg),

                  // Condition chips
                  Text('Condition', style: theme.textTheme.labelLarge),
                  const SizedBox(height: AppTheme.spacingSm),
                  Wrap(
                    spacing: AppTheme.spacingSm,
                    runSpacing: AppTheme.spacingSm,
                    children: AppConstants.conditions.map((cond) {
                      return ChoiceChip(
                        label: Text(cond),
                        selected: _selectedCondition == cond,
                        onSelected: (selected) {
                          setState(() =>
                              _selectedCondition = selected ? cond : null);
                        },
                      );
                    }).toList(),
                  ),
                  if (_selectedCondition == null) ...[
                    const SizedBox(height: AppTheme.spacingXs),
                    Text(
                      'Select the condition of your item',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: AppTheme.muted,
                      ),
                    ),
                  ],
                  const SizedBox(height: AppTheme.spacingLg),

                  // Listing kind
                  Text('Listing type', style: theme.textTheme.labelLarge),
                  const SizedBox(height: AppTheme.spacingSm),
                  SegmentedButton<ListingKind>(
                    segments: const [
                      ButtonSegment(
                        value: ListingKind.single,
                        label: Text('Single item'),
                        icon: Icon(Icons.style_outlined, size: 16),
                      ),
                      ButtonSegment(
                        value: ListingKind.shopfront,
                        label: Text('Binder'),
                        icon: Icon(Icons.library_books_outlined, size: 16),
                      ),
                    ],
                    selected: {_listingKind},
                    onSelectionChanged: (selection) {
                      setState(() => _listingKind = selection.first);
                    },
                  ),
                  if (_listingKind == ListingKind.shopfront) ...[
                    const SizedBox(height: AppTheme.spacingSm),
                    Container(
                      padding: const EdgeInsets.all(AppTheme.spacingMd),
                      decoration: BoxDecoration(
                        color: AppTheme.warningLight,
                        borderRadius:
                            BorderRadius.circular(AppTheme.radiusSm),
                      ),
                      child: Text(
                        'A binder listing lets buyers browse and request '
                        'specific items. Nothing is held — multiple buyers '
                        'can negotiate simultaneously.',
                        style: AppTheme.supportText.copyWith(
                          color: AppTheme.warning,
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: AppTheme.spacingLg),

                  // Location
                  TextFormField(
                    controller: _locationController,
                    style: AppTheme.bodyText,
                    decoration: InputDecoration(
                      hintText: 'City or suburb',
                      hintStyle: AppTheme.bodyText.copyWith(
                        color: AppTheme.muted,
                      ),
                      prefixIcon:
                          const Icon(Icons.location_on_outlined, size: 18),
                    ),
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
        AppTheme.spacingXl,
        AppTheme.spacingMd,
        AppTheme.spacingXl,
        AppTheme.spacingXl,
      ),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        border: const Border(
          top: BorderSide(color: AppTheme.border, width: 0.5),
        ),
        boxShadow: [
          BoxShadow(
            color: AppTheme.obsidian.withValues(alpha: 0.04),
            blurRadius: 8,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          width: double.infinity,
          height: 40,
          child: FilledButton(
            onPressed: _isSubmitting ? null : _publish,
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.gold,
              foregroundColor: Colors.white,
              disabledBackgroundColor:
                  AppTheme.gold.withValues(alpha: 0.5),
              disabledForegroundColor:
                  Colors.white.withValues(alpha: 0.7),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
              ),
              textStyle: Theme.of(context).textTheme.labelLarge,
            ),
            child: _isSubmitting
                ? Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const SizedBox(
                        height: 16,
                        width: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(width: AppTheme.spacingMd),
                      Text(_submitLabel),
                    ],
                  )
                : const Text('Publish'),
          ),
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
        mainAxisSpacing: AppTheme.spacingMd,
        crossAxisSpacing: AppTheme.spacingMd,
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
    return GestureDetector(
      onTap: onTap,
      child: CustomPaint(
        painter: _DashedBorderPainter(
          color: AppTheme.border,
          radius: AppTheme.radiusMd,
        ),
        child: Container(
          decoration: BoxDecoration(
            color: AppTheme.surfaceVariant.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.camera_alt_outlined,
                color: AppTheme.muted,
                size: 28,
              ),
              const SizedBox(height: AppTheme.spacingXs),
              const Text(
                'Add Photo',
                style: AppTheme.metaText,
              ),
              const SizedBox(height: 2),
              Text(
                '$count/${AppConstants.imagesMax}',
                style: AppTheme.metaText,
              ),
            ],
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
        GestureDetector(
          onTap: () => _showLocalImagePreview(context, file),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
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
                return Container(
                  color: AppTheme.surfaceVariant,
                  child: const Center(
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                );
              },
            ),
          ),
        ),

        // Remove button (48x48 touch target)
        Positioned(
          top: 0,
          right: 0,
          child: Semantics(
            button: true,
            label: 'Remove image',
            child: SizedBox(
              width: 48,
              height: 48,
              child: IconButton.filled(
                onPressed: onRemove,
                icon: const Icon(Icons.close, size: 16),
                style: IconButton.styleFrom(
                  backgroundColor:
                      AppTheme.obsidian.withValues(alpha: 0.6),
                  foregroundColor: Colors.white,
                  minimumSize: const Size(48, 48),
                  padding: EdgeInsets.zero,
                ),
                constraints: const BoxConstraints(
                  minWidth: 36,
                  minHeight: 36,
                ),
              ),
            ),
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
                color: AppTheme.gold.withValues(alpha: 0.85),
                borderRadius: BorderRadius.circular(AppTheme.radiusSm),
              ),
              child: Text(
                'Cover',
                style: AppTheme.badgeText.copyWith(color: Colors.white),
              ),
            ),
          ),
      ],
    );
  }
}

/// Shows a fullscreen dialog preview of a locally-picked image.
void _showLocalImagePreview(BuildContext context, XFile file) {
  showDialog(
    context: context,
    barrierColor: Colors.black87,
    builder: (ctx) => Dialog.fullscreen(
      backgroundColor: Colors.black,
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
                return const CircularProgressIndicator(
                  color: Colors.white70,
                  strokeWidth: 2,
                );
              },
            ),
          ),
          Positioned(
            top: MediaQuery.of(ctx).padding.top + 8,
            left: 12,
            child: Semantics(
              button: true,
              label: 'Close preview',
              child: GestureDetector(
                onTap: () => Navigator.of(ctx).pop(),
                child: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.5),
                    shape: BoxShape.circle,
                  ),
                  child: const Center(
                    child: Icon(
                      Icons.close,
                      color: Colors.white,
                      size: 22,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
