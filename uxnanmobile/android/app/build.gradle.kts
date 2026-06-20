plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
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

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
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
