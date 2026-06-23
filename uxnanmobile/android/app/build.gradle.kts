import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing config, loaded from android/key.properties when present. The
// CI release job (release-mobile.yml) generates that file from GitHub Secrets;
// it is gitignored and never committed. When absent (local dev), release falls
// back to the debug keys below. See uxnanmobile/FOR-HUMAN.md.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

// FOR-HUMAN: apply the Google Services plugin ONLY when google-services.json is
// present, so the app keeps building without Firebase config (push just stays
// disabled). Drop the json into this folder to enable FCM. See FOR-HUMAN.md.
// FOR-HUMAN: when the bundle id changed (2026-06-20: com.uxnan.mobile ->
// dev.luisgamas.uxnanmobile), the locally-cached google-services.json was
// deleted because it was pinned to the OLD package name and would fail at
// Firebase.initializeApp(). Re-register / re-fetch the Android app under the
// new bundle id (Firebase Console or `firebase apps:sdkconfig ANDROID
// <android-app-id> --project uxnan-app --out
// uxnanmobile/android/app/google-services.json`) so this plugin has a config
// to apply. The conditional below keeps the build green in the meantime.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "dev.luisgamas.uxnanmobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Required by flutter_local_notifications (desugars java.time on minSdk 24).
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        applicationId = "dev.luisgamas.uxnanmobile"
        // Per architecture spec (02b §3.4): Android minimo API 24 (Android 7.0).
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (keystorePropertiesFile.exists()) {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            // Sign with the upload keystore (key.properties) when available
            // (CI release builds); otherwise fall back to the debug keys so
            // `flutter run --release` still works locally without secrets.
            signingConfig = if (keystorePropertiesFile.exists()) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }

            // R8/minification + resource shrinking ON (smaller release). R8
            // full mode (AGP 9 default) strips the no-arg constructors of the
            // reflectively-instantiated component registrars used by ML Kit
            // (BarcodeRegistrar) and Firebase (FirebaseMessagingKtxRegistrar) —
            // "NoSuchMethodException: <init>[]" — which broke the QR scanner
            // (mobile_scanner NPE: "getClass() on a null object reference") and
            // FCM push. `proguard-rules.pro` keeps those, so both keep working
            // while everything else is shrunk.
            // FOR-DEV: if a new reflective dep breaks only in --release, add its
            // keep rule to proguard-rules.pro (debug doesn't minify). Always
            // re-test a QR scan + a background push in --release before shipping.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    // Backports java.time etc. for minSdk 24; required by flutter_local_notifications.
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

flutter {
    source = "../.."
}
