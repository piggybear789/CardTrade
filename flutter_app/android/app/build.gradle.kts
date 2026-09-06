import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing credentials live in flutter_app/android/key.properties, which is untracked
// (Req 2.2). `rootProject` here is flutter_app/android, so this resolves to
// flutter_app/android/key.properties. Absent, the file loads as empty and only RELEASE tasks
// fail (Req 2.3) — debug builds and `flutter test` must keep working without a keystore.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties =
    Properties().apply {
        if (keystorePropertiesFile.exists()) {
            keystorePropertiesFile.inputStream().use { load(it) }
        }
    }
val hasKeystore = keystoreProperties.isNotEmpty()

/**
 * The fail-closed message. Names the missing file and the Build_Docs section that explains how
 * to create it (Req 2.3). Never names a password, alias or keystore path.
 */
val missingKeystoreMessage =
    "Release signing is not configured: flutter_app/android/key.properties is missing. " +
        "See flutter_app/BUILD.md > Release signing for the keytool command and the four " +
        "fields the file requires. No keystore is committed to this repository by design."

android {
    namespace = "app.noditto"
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Fixed at the first store upload and never changeable afterwards (Req 1.1, 1.8).
        applicationId = "app.noditto"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            // Every value comes from the untracked key.properties (Req 2.2). Left null when the
            // file is absent; the guards below are what turn that into a loud failure.
            keyAlias = keystoreProperties["keyAlias"] as String?
            keyPassword = keystoreProperties["keyPassword"] as String?
            storeFile = (keystoreProperties["storeFile"] as String?)?.let { file(it) }
            storePassword = keystoreProperties["storePassword"] as String?
        }
    }

    buildTypes {
        release {
            // Req 2.1, 2.5: the release buildType is signed with the real upload key and never
            // with the debug key.
            signingConfig = signingConfigs.getByName("release")

            // Req 9.1: code shrinking and resource shrinking. isShrinkResources requires
            // isMinifyEnabled — AGP fails configuration if resources are shrunk without R8.
            isMinifyEnabled = true
            isShrinkResources = true

            // Req 9.2: the AGP "optimize" default plus our own keep rules. Almost everything
            // reflective in this app is covered by consumer rules shipped inside the
            // dependencies themselves; proguard-rules.pro documents that audit and holds only
            // what is genuinely ours. Read it before adding anything here.
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}

// Fail closed, in two layers, because either one alone has a hole (Req 2.3).
//
// Layer 1 — configuration time. `flutter build appbundle --release` invokes :app:bundleRelease
// and `flutter run --release` invokes :app:assembleRelease, so both carry "Release" in the
// requested task name and are caught before any work starts.
if (!hasKeystore && gradle.startParameter.taskNames.any { it.contains("Release") }) {
    throw GradleException(missingKeystoreMessage)
}

// Layer 2 — execution time. The task-name probe only reads what was typed on the command line,
// so a release variant reached indirectly (an aggregate task, an IDE run configuration, a task
// that depends on bundleRelease) slips past it. `tasks.matching` realises nothing on its own,
// so this adds no cost and no failure to a debug build or to `flutter test`: the doFirst only
// exists for release tasks that are actually in the graph.
if (!hasKeystore) {
    tasks.matching { it.name.contains("Release") }.configureEach {
        doFirst { throw GradleException(missingKeystoreMessage) }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
