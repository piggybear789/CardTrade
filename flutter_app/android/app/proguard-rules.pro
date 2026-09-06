# R8 keep rules for the NoDitto release build (Req 9.1, 9.2).
#
# READ THIS BEFORE ADDING A RULE.
#
# Every rule below states WHY it exists and WHAT BREAKS without it. A keep rule with no reason
# is one nobody can ever safely delete, so it stays forever and keeps growing — which is how a
# shrunk build ends up the same size as an unshrunk one.
#
# Rules are also NOT added here speculatively. Most AndroidX-era libraries ship their own
# consumer ProGuard rules inside the AAR, and AGP applies those automatically; duplicating them
# here is noise that hides the rules that actually matter. The audit of what is already covered
# is recorded at the bottom of this file, with the file paths and versions the audit read, so a
# future reader can re-run it rather than re-guess it.
#
# ============================================================================================
# HONESTY NOTE, and it is load-bearing.
#
# These rules are UNVERIFIED against a real R8 run. Per design decision D12 this repository
# carries no upload keystore, so a release build fails closed before R8 ever executes, and no
# amount of Gradle configuration checking substitutes for that. Manual check M10 in the design's
# review register — the shrunk-build walkthrough: sign-in, catalog, listing detail, a contract
# room, messaging, avatar crop, closure entry — is the ONLY thing that can confirm this file.
#
# Rules that are a JUDGEMENT rather than a known requirement are labelled "GUESS" below. An
# honestly-labelled guess is useful; a confidently wrong keep rule is how a release crashes in
# a place nobody looks.
# ============================================================================================


# --------------------------------------------------------------------------------------------
# Stack traces must survive obfuscation
# --------------------------------------------------------------------------------------------
# WHY: Req 9.4 wants a deobfuscation mapping uploaded with the bundle. A mapping file can only
# restore a class name; it cannot restore a line number that was never emitted. Without these,
# every release crash report is a stack of method names with no line information, which is the
# difference between a report you can act on and a report you can only file.
#
# WHAT BREAKS: nothing at runtime — this is a diagnosability rule, not a correctness one.
#
# NOTE: proguard-android-optimize.txt is believed to set both of these already. -keepattributes
# is additive and repeating it is harmless, and the failure mode of omitting it (unreadable
# release crashes, discovered only during an incident) is far worse than the failure mode of
# stating it twice. Kept deliberately rather than assumed.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile


# --------------------------------------------------------------------------------------------
# UCrop — image_cropper's cropping Activity
# --------------------------------------------------------------------------------------------
# WHY: image_cropper launches com.yalantis.ucrop.UCropActivity by class name, and task 3.1
# declared it in AndroidManifest.xml. A class reached only through a manifest string and a
# reflective start is exactly the shape R8 cannot see: nothing in Dart or Kotlin references the
# symbol, so tree-shaking is entitled to remove it.
#
# WHAT BREAKS: the avatar crop step (manual check M8). The picker returns an image, the crop
# screen fails to start, and the member sees a failure on a flow that works in debug.
#
# ALREADY COVERED, and kept anyway — deliberately, not by oversight. image_cropper 12.2.1 ships
# consumer-proguard-rules.pro with this exact keep plus the okhttp3 keep UCrop needs (see the
# audit at the bottom). This copy is a hedge on ONE thing only: that a future image_cropper
# version keeps shipping that consumer file. If it stops, the symptom is a crop failure in a
# signed build that debug builds cannot reproduce, which is expensive to diagnose and cheap to
# prevent. If image_cropper is ever removed from pubspec.yaml, delete this block with it.
-keep class com.yalantis.ucrop.** { *; }
-dontwarn com.yalantis.ucrop.**


# --------------------------------------------------------------------------------------------
# Nothing else is added here. What follows is the audit, not a list of rules.
# --------------------------------------------------------------------------------------------
#
# STRIPE ANDROID SDK — fully covered by the plugin's own consumer rules. Add nothing.
#
#   flutter_stripe 13.1.0 delegates Android to stripe_android 13.1.0, whose
#   android/build.gradle declares `consumerProguardFiles 'proguard-rules.txt'`. That file
#   already carries `-keep class com.stripe.** { *; }` (its own comment names the crash it
#   fixes: PaymentFlowResult$Unvalidated$Companion on 3D Secure authentication), plus
#   -keepclassmembers for com.stripe.android.pushProvisioning.** and
#   com.google.android.gms.tapandpay.**, plus -dontwarn for the optional push-provisioning
#   entry points and kotlinx.parcelize.
#
#   The named gaps in the brief — 3DS and push provisioning — are therefore both closed
#   upstream. Duplicating a blanket `-keep class com.stripe.**` here would add nothing except a
#   second place to maintain the same rule.
#
#   Underneath the plugin, com.stripe:*:23.10.1 modules ship their own proguard.txt inside the
#   AAR: stripe-core, payments-core, payments-model, payments-ui-core, paymentsheet,
#   stripe-3ds2-android and the financial-connections trio. Those are what keep the
#   @kotlinx.serialization.Serializable enums and the ActivityResultContract subclasses that
#   Stripe resolves reflectively.
#
#   Not for this app: the platform never uses Financial Connections, card scanning, Google
#   Places or Stripe Terminal. The SDK's rules for those are -dontwarn entries for compile-only
#   dependencies, which cost nothing.
#
# FLUTTER_LOCAL_NOTIFICATIONS — no Gson rules required at version 22.3.0. Add nothing.
#
#   The plugin does deserialise scheduled notifications with Gson (it depends on
#   com.google.code.gson:gson:2.12.0), so the concern is real, and older guides do tell you to
#   paste a block of Gson keeps. That guidance is obsolete: the plugin's own
#   example/android/app/proguard-rules.pro opens with "This file is not required for
#   flutter_local_notifications v19 and higher".
#
#   Verified rather than taken on trust. Every Gson-serialised model in the plugin carries
#   androidx.annotation.@Keep — NotificationDetails, NotificationAction, PersonDetails,
#   MessageDetails, Time, ScheduleMode, the source/style enums, and all six StyleInformation
#   classes. That last set matters most: the plugin resolves style polymorphism through
#   RuntimeTypeAdapterFactory, which labels subtypes by simple class name, so obfuscating those
#   names would break rehydration of a scheduled notification after a reboot. @Keep prevents
#   exactly that, and androidx.annotation supplies the rule that honours it.
#
#   Gson 2.12.0 additionally embeds META-INF/proguard/gson.pro, which R8 applies automatically:
#   -keepattributes Signature, the TypeToken keeps, and the @SerializedName field keeps.
#
# FLUTTER EMBEDDING — covered by the default Flutter rules. Checked, not assumed. Add nothing.
#
#   The Flutter Gradle plugin appends packages/flutter_tools/gradle/flutter_proguard_rules.pro
#   to every minified variant. It carries -dontwarn io.flutter.plugin.**, -dontwarn android.**,
#   and a conditional keep on every implementor of
#   io.flutter.embedding.engine.plugins.FlutterPlugin (flutter/flutter#154580 — R8 was
#   incorrectly stripping plugin classes). Restating any of that here would be duplication.
#
# ERROR REPORTER — nothing to keep, because there is no vendor SDK.
#
#   Design decision D13 ships the reporter as a seam plus a no-op binding and deliberately no
#   vendor SDK, so there are no native bindings for R8 to strip. When a provider is chosen, its
#   keep rules land here and this paragraph is replaced — and per D13 they must be verified
#   against a shrunk build at that point, not asserted.
#
# AUDIT PROVENANCE — re-run this rather than trusting the summary above. Consumer rules live at
# <pub-cache>/hosted/pub.dev/stripe_android-13.1.0/android/proguard-rules.txt and
# .../image_cropper-12.2.1/android/consumer-proguard-rules.pro; the com.stripe AAR rules are
# the proguard.txt entries inside each .aar under <gradle-home>/caches/modules-2/files-2.1/
# com.stripe/. Re-audit after any bump to flutter_stripe, image_cropper,
# flutter_local_notifications or the Flutter SDK, because a consumer rule silently disappearing
# is a release-only regression.
