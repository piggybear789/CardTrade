import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/router/router.dart';

/// Forgot-password screen — send a reset link to the user's email.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  bool _linkSent = false;

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _handleSendReset() async {
    if (!_formKey.currentState!.validate()) return;

    await ref
        .read(authActionsProvider.notifier)
        .sendPasswordReset(_emailController.text.trim());

    if (!mounted) return;

    final state = ref.read(authActionsProvider);
    if (state.hasError) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(state.error.toString()),
          backgroundColor: AppTheme.danger,
        ),
      );
    } else {
      setState(() => _linkSent = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authActionsProvider);
    final isLoading = authState.isLoading;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => context.pop(),
        ),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.spacingXl,
              vertical: AppTheme.spacingXxl,
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: _linkSent ? _buildSuccessState(context) : _buildForm(context, isLoading),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildForm(BuildContext context, bool isLoading) {
    return Form(
      key: _formKey,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // ─── Icon ──────────────────────────────────────────────────────
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: AppTheme.accentLight,
              borderRadius: BorderRadius.circular(AppTheme.radiusLg),
            ),
            child: const Icon(
              Icons.lock_reset_rounded,
              size: 32,
              color: AppTheme.accent,
            ),
          ),
          const SizedBox(height: AppTheme.spacingXl),

          // ─── Title ─────────────────────────────────────────────────────
          Text(
            'Reset Password',
            style: Theme.of(context).textTheme.headlineLarge,
          ),
          const SizedBox(height: AppTheme.spacingSm),
          Text(
            "Enter your email and we'll send you a link to reset your password.",
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppTheme.secondary,
                ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppTheme.spacingXxl),

          // ─── Email Field ───────────────────────────────────────────────
          TextFormField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.email],
            decoration: const InputDecoration(
              labelText: 'Email',
              hintText: 'you@example.com',
              prefixIcon: Icon(Icons.mail_outline_rounded),
            ),
            validator: (value) {
              if (value == null || value.trim().isEmpty) {
                return 'Email is required';
              }
              if (!value.contains('@')) {
                return 'Enter a valid email';
              }
              return null;
            },
            onFieldSubmitted: (_) => _handleSendReset(),
          ),
          const SizedBox(height: AppTheme.spacingXl),

          // ─── Send Reset Link Button ────────────────────────────────────
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: isLoading ? null : _handleSendReset,
              child: isLoading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Send Reset Link'),
            ),
          ),
          const SizedBox(height: AppTheme.spacingXl),

          // ─── Back to Sign In ───────────────────────────────────────────
          TextButton(
            onPressed: () => context.go(AppRoutes.signIn),
            child: const Text('Back to Sign In'),
          ),
        ],
      ),
    );
  }

  Widget _buildSuccessState(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // ─── Success Icon ──────────────────────────────────────────────
        Container(
          width: 80,
          height: 80,
          decoration: BoxDecoration(
            color: AppTheme.successLight,
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.mark_email_read_outlined,
            size: 40,
            color: AppTheme.success,
          ),
        ),
        const SizedBox(height: AppTheme.spacingXl),

        // ─── Title ───────────────────────────────────────────────────────
        Text(
          'Check your email',
          style: Theme.of(context).textTheme.headlineLarge,
        ),
        const SizedBox(height: AppTheme.spacingSm),
        Text(
          'We sent a password reset link to',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: AppTheme.secondary,
              ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AppTheme.spacingXs),
        Text(
          _emailController.text.trim(),
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AppTheme.spacingXxl),

        // ─── Instruction ─────────────────────────────────────────────────
        Container(
          padding: const EdgeInsets.all(AppTheme.spacingLg),
          decoration: BoxDecoration(
            color: AppTheme.surfaceVariant,
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.info_outline_rounded,
                size: 20,
                color: AppTheme.secondary,
              ),
              const SizedBox(width: AppTheme.spacingSm),
              Expanded(
                child: Text(
                  "Didn't receive the email? Check your spam folder or try again.",
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTheme.spacingXl),

        // ─── Try Again / Back ────────────────────────────────────────────
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(
            onPressed: () => setState(() => _linkSent = false),
            child: const Text('Try a different email'),
          ),
        ),
        const SizedBox(height: AppTheme.spacingMd),
        TextButton(
          onPressed: () => context.go(AppRoutes.signIn),
          child: const Text('Back to Sign In'),
        ),
      ],
    );
  }
}
